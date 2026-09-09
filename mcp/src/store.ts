import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  irNode,
  parseViewIr,
  normalizeScreenLayout,
  normalizeGrid,
  resolveShowPlacement,
  assertPlacement,
  defaultPlacement,
  type IrNode,
  type ViewIr,
  type Placement,
  type ScreenLayout,
  COMPONENT_TYPES,
  type ComponentType,
} from "@eow/ir";
import {
  cacheForKeys,
  deleteDatasetFile,
  getDataset,
  isEphemeralDatasetKey,
  isPersistedDatasetKey,
  listDatasets,
  refreshDatasetRecord,
  refreshDueDatasetRecords,
  summarizeDataset,
  upsertDataset,
} from "./datasets.js";
import {
  carouselPath,
  ensureDirs,
  nowIso,
  screenPath,
  stateDir,
  viewFilePath,
  viewsIndexPath,
  writeAtomic,
} from "./paths.js";

export const CAROUSEL_TRANSITIONS = ["fade", "slide", "scale"] as const;
export type CarouselTransition = (typeof CAROUSEL_TRANSITIONS)[number];

export type CarouselState = {
  enabled: boolean;
  /** null = cycle all saved views; otherwise ordered subset of view ids */
  viewIds: string[] | null;
  intervalSec: number;
  transition: CarouselTransition;
};

const MIN_CAROUSEL_INTERVAL_SEC = 3;
const MAX_CAROUSEL_INTERVAL_SEC = 600;
const DEFAULT_CAROUSEL_INTERVAL_SEC = 10;

export function emptyCarousel(): CarouselState {
  return {
    enabled: false,
    viewIds: null,
    intervalSec: DEFAULT_CAROUSEL_INTERVAL_SEC,
    transition: "fade",
  };
}

export type ScreenState = {
  definition: ViewIr | null;
  inlineData: Record<string, unknown>;
  layout: ScreenLayout;
  activeViewId: string | null;
  updatedAt: string;
};

export type SavedViewMeta = {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
};

export type SavedView = SavedViewMeta & {
  definition: ViewIr;
  layout: ScreenLayout;
};

export type WidgetSpec = {
  id: string;
  type: ComponentType;
  props?: Record<string, unknown>;
  data?: unknown;
  /** Nested widgets (e.g. HorizontalTiles template). Flattened into definition.nodes. */
  children?: WidgetSpec[];
};

export { stateDir, screenPath, viewsIndexPath, carouselPath };

function defaultLayout(): ScreenLayout {
  return normalizeScreenLayout({
    grid: normalizeGrid(),
    placements: {},
  });
}

export function emptyScreen(): ScreenState {
  return {
    definition: null,
    inlineData: {},
    layout: defaultLayout(),
    activeViewId: null,
    updatedAt: nowIso(),
  };
}

function boundDatasetKeys(definition: ViewIr | null): string[] {
  if (!definition) return [];
  const keys = new Set<string>(definition.datasets ?? []);
  for (const node of Object.values(definition.nodes)) {
    const props = (node as { props?: Record<string, unknown> }).props;
    const ds = props && typeof props.dataset === "string" ? props.dataset : null;
    if (ds) keys.add(ds);
  }
  return [...keys];
}

/** Merge persisted dataset caches into inlineData; keep ephemeral _screen.* / _url.*. */
export function hydrateScreenFromDatasets(state: ScreenState): ScreenState {
  const ephemeral: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state.inlineData)) {
    if (isEphemeralDatasetKey(k)) ephemeral[k] = v;
  }
  const cached = cacheForKeys(boundDatasetKeys(state.definition));
  return { ...state, inlineData: { ...ephemeral, ...cached } };
}

export function getScreen(): ScreenState {
  ensureDirs();
  if (!existsSync(screenPath())) return emptyScreen();
  try {
    const raw = JSON.parse(readFileSync(screenPath(), "utf8"));
    const state: ScreenState = {
      definition: (raw.definition as ViewIr | null) ?? null,
      inlineData: (raw.inlineData as Record<string, unknown>) ?? {},
      layout: normalizeScreenLayout(raw.layout ?? defaultLayout()),
      activeViewId: raw.activeViewId ?? null,
      updatedAt: raw.updatedAt ?? nowIso(),
    };
    return hydrateScreenFromDatasets(state);
  } catch {
    return emptyScreen();
  }
}

export function persistScreen(state: ScreenState): ScreenState {
  const hydrated = hydrateScreenFromDatasets(state);
  const next = { ...hydrated, updatedAt: nowIso() };
  writeAtomic(screenPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function clearScreen(): ScreenState {
  const prev = getScreen();
  return persistScreen({
    ...emptyScreen(),
    layout: normalizeScreenLayout({
      grid: prev.layout.grid,
      placements: {},
      themeId: prev.layout.themeId,
    }),
  });
}

function buildNode(spec: WidgetSpec, childIds: string[] = []): IrNode {
  const layoutTypes = new Set([
    "Stack",
    "Group",
    "Grid",
    "Container",
    "Panel",
    "ScrollArea",
    "Card",
    "HorizontalTiles",
    "Repeat",
  ]);
  const base: Record<string, unknown> = {
    type: spec.type,
    props: spec.props ?? {},
  };
  if (layoutTypes.has(spec.type) || childIds.length > 0) {
    base.children = childIds;
  }
  return irNode.parse(base);
}

/** Flatten a widget tree into IR nodes keyed by id (depth-first). */
function flattenWidgetTree(spec: WidgetSpec): Record<string, IrNode> {
  const nodes: Record<string, IrNode> = {};
  const seen = new Set<string>();

  function walk(s: WidgetSpec): string {
    if (seen.has(s.id)) {
      throw new Error(`Duplicate widget id in tree: ${s.id}`);
    }
    seen.add(s.id);
    const childIds = (s.children ?? []).map(walk);
    nodes[s.id] = buildNode(s, childIds);
    return s.id;
  }

  walk(spec);
  return nodes;
}

/** Collect all node ids under a root (inclusive), for subtree replace. */
function collectSubtreeIds(nodes: Record<string, IrNode>, rootId: string): Set<string> {
  const out = new Set<string>();
  function walk(id: string) {
    if (out.has(id)) return;
    out.add(id);
    const n = nodes[id];
    if (n && "children" in n && Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  }
  walk(rootId);
  return out;
}

function collectDatasetFromProps(props: Record<string, unknown>): string | null {
  return typeof props.dataset === "string" ? props.dataset : null;
}

function applyInlineData(
  inlineData: Record<string, unknown>,
  spec: WidgetSpec,
): { inlineData: Record<string, unknown>; datasetKey: string | null } {
  if (spec.data === undefined) {
    return { inlineData, datasetKey: collectDatasetFromProps(spec.props ?? {}) };
  }
  const key = collectDatasetFromProps(spec.props ?? {}) ?? `_screen.${spec.id}`;
  if (!isEphemeralDatasetKey(key)) {
    throw new Error(
      `widget.data requires an ephemeral key (_screen.*). For live refresh use ud_datasets_upsert + props.dataset without data.`,
    );
  }
  return { inlineData: { ...inlineData, [key]: spec.data }, datasetKey: key };
}

function collectBoundDatasets(
  nodes: Record<string, IrNode>,
  inlineData: Record<string, unknown>,
  existing: string[] = [],
): string[] {
  const bound = new Set<string>(existing);
  for (const node of Object.values(nodes)) {
    const ds = collectDatasetFromProps(node.props as Record<string, unknown>);
    if (ds) bound.add(ds);
  }
  for (const key of Object.keys(inlineData)) {
    if (isEphemeralDatasetKey(key) || isPersistedDatasetKey(key)) bound.add(key);
  }
  return [...bound];
}

function parseScreenDefinition(
  partial: {
    irVersion: 1;
    title: string;
    root: string;
    nodes: Record<string, IrNode>;
    datasets?: string[];
  },
  inlineData: Record<string, unknown>,
): ViewIr {
  return parseViewIr({
    ...partial,
    datasets: collectBoundDatasets(partial.nodes, inlineData, partial.datasets ?? []),
  });
}

export function showOnScreen(input: {
  widget: WidgetSpec;
  replace?: boolean;
  column?: number;
  index?: number;
  colspan?: number;
  align?: Placement["align"];
}): ScreenState {
  const state = getScreen();
  const { inlineData, datasetKey } = applyInlineData(state.inlineData, input.widget);
  const props = { ...(input.widget.props ?? {}) };
  if (datasetKey && !props.dataset) props.dataset = datasetKey;

  const boundKey = typeof props.dataset === "string" ? props.dataset : null;
  if (boundKey && isPersistedDatasetKey(boundKey) && !getDataset(boundKey)) {
    throw new Error(
      `Dataset "${boundKey}" not found. Call ud_datasets_upsert (+ ud_datasets_refresh) before binding Stat/Table/HorizontalTiles.`,
    );
  }

  if (
    (input.widget.type === "HorizontalTiles" || input.widget.type === "Repeat") &&
    !(input.widget.children && input.widget.children.length > 0)
  ) {
    throw new Error(
      `HorizontalTiles "${input.widget.id}" needs children[] (template stamped per dataset row). Example: Stack with Icon+Text inside.`,
    );
  }

  const treeNodes = flattenWidgetTree({ ...input.widget, props });

  const rootKids =
    state.definition && !input.replace
      ? "children" in state.definition.nodes[state.definition.root]!
        ? (state.definition.nodes[state.definition.root] as { children: string[] }).children
        : []
      : [];

  const placement = resolveShowPlacement(
    state.layout.grid,
    {
      column: input.column,
      index: input.index,
      colspan: input.colspan,
      align: input.align,
    },
    { isFirst: !state.definition || !!input.replace || rootKids.length === 0 },
  );

  if (!state.definition || input.replace) {
    const definition = parseScreenDefinition(
      {
        irVersion: 1,
        title: "Screen",
        root: "screen-root",
        nodes: {
          "screen-root": { type: "Stack", props: { gap: "md" }, children: [input.widget.id] },
          ...treeNodes,
        },
      },
      inlineData,
    );
    return persistScreen({
      definition,
      inlineData,
      activeViewId: null,
      layout: normalizeScreenLayout({
        grid: state.layout.grid,
        placements: { [input.widget.id]: placement },
        themeId: state.layout.themeId,
      }),
      updatedAt: state.updatedAt,
    });
  }

  const root = state.definition.nodes[state.definition.root];
  if (!root || !("children" in root)) {
    throw new Error("Screen root cannot accept children");
  }

  // Drop previous subtree for this id when re-showing (template updates).
  const drop = state.definition.nodes[input.widget.id]
    ? collectSubtreeIds(state.definition.nodes, input.widget.id)
    : new Set<string>();
  const nodes: Record<string, IrNode> = {};
  for (const [id, n] of Object.entries(state.definition.nodes)) {
    if (!drop.has(id)) nodes[id] = n;
  }
  Object.assign(nodes, treeNodes);

  const children = root.children.includes(input.widget.id) ? root.children : [...root.children, input.widget.id];
  nodes[state.definition.root] = { ...root, children };
  const definition = parseScreenDefinition({ ...state.definition, nodes }, inlineData);
  return persistScreen({
    definition,
    inlineData,
    activeViewId: state.activeViewId,
    layout: normalizeScreenLayout({
      grid: state.layout.grid,
      placements: { ...state.layout.placements, [input.widget.id]: placement },
      themeId: state.layout.themeId,
    }),
    updatedAt: state.updatedAt,
  });
}

export function configureScreenGrid(input: {
  columns?: number;
  visible?: boolean;
}): ScreenState {
  const state = getScreen();
  const grid = normalizeGrid({
    columns: input.columns ?? state.layout.grid.columns,
    visible: input.visible ?? state.layout.grid.visible,
  });
  const placements: Record<string, Placement> = {};
  for (const [id, p] of Object.entries(state.layout.placements)) {
    try {
      assertPlacement(grid.columns, p, id);
      const colspan = Math.min(grid.columns, Math.max(1, p.colspan ?? 1));
      placements[id] = {
        ...p,
        colspan,
        column: p.column != null ? Math.min(p.column, grid.columns) : undefined,
      };
    } catch {
      placements[id] = defaultPlacement(grid);
    }
  }
  return persistScreen({
    ...state,
    layout: normalizeScreenLayout({ grid, placements, themeId: state.layout.themeId }),
  });
}

function readViewsIndex(): SavedViewMeta[] {
  ensureDirs();
  if (!existsSync(viewsIndexPath())) return [];
  try {
    const raw = JSON.parse(readFileSync(viewsIndexPath(), "utf8"));
    return Array.isArray(raw.views) ? raw.views : [];
  } catch {
    return [];
  }
}

function writeViewsIndex(views: SavedViewMeta[]) {
  writeAtomic(viewsIndexPath(), JSON.stringify({ views }, null, 2) + "\n");
}

export function listViews(): SavedViewMeta[] {
  return readViewsIndex();
}

export function getView(id: string): SavedView | null {
  const path = viewFilePath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SavedView;
  } catch {
    return null;
  }
}

export function saveScreenAsView(input: { slug: string; title?: string }): SavedView {
  const state = getScreen();
  if (!state.definition) throw new Error("Nothing on screen to save");
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error("Invalid slug");

  const index = readViewsIndex();
  const existing = index.find((v) => v.slug === slug);
  const id = existing?.id ?? randomUUID();
  const title = input.title?.trim() || state.definition.title || slug;
  const updatedAt = nowIso();
  const definition =
    title !== state.definition.title ? parseViewIr({ ...state.definition, title }) : state.definition;
  const saved: SavedView = {
    id,
    slug,
    title,
    updatedAt,
    definition,
    layout: state.layout,
  };
  writeAtomic(viewFilePath(id), JSON.stringify(saved, null, 2) + "\n");
  const nextIndex = existing
    ? index.map((v) => (v.id === id ? { id, slug, title, updatedAt } : v))
    : [...index, { id, slug, title, updatedAt }];
  writeViewsIndex(nextIndex);
  persistScreen({
    ...state,
    definition,
    activeViewId: id,
    updatedAt,
  });
  return saved;
}

export function deleteView(id: string): { deleted: string; cleared: boolean } {
  const view = getView(id);
  if (!view) throw new Error(`View not found: ${id}`);
  const path = viewFilePath(id);
  if (existsSync(path)) unlinkSync(path);
  writeViewsIndex(readViewsIndex().filter((v) => v.id !== id));
  const state = getScreen();
  if (state.activeViewId === id) {
    clearScreen();
    return { deleted: id, cleared: true };
  }
  return { deleted: id, cleared: false };
}

export function loadViewOnScreen(id: string): ScreenState {
  const view = getView(id);
  if (!view) throw new Error(`View not found: ${id}`);
  return persistScreen({
    definition: view.definition,
    inlineData: {},
    layout: normalizeScreenLayout(view.layout),
    activeViewId: view.id,
    updatedAt: nowIso(),
  });
}

export function summarizeScreen(state: ScreenState) {
  const inlineData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state.inlineData)) {
    if (Array.isArray(value)) {
      inlineData[key] = { kind: "array", rows: value.length, preview: value.slice(0, 3), truncated: value.length > 3 };
    } else if (value && typeof value === "object") {
      inlineData[key] = { kind: "object", preview: value, truncated: false };
    } else {
      inlineData[key] = { kind: "other", preview: value, truncated: false };
    }
  }
  return {
    definition: state.definition,
    layout: state.layout,
    activeViewId: state.activeViewId,
    updatedAt: state.updatedAt,
    inlineData,
  };
}

function syncDatasetIntoLiveScreen(key: string, data: unknown) {
  const state = getScreen();
  if (!state.definition) return;
  if (!boundDatasetKeys(state.definition).includes(key)) return;
  persistScreen({
    ...state,
    inlineData: { ...state.inlineData, [key]: data },
  });
}

export async function refreshDataset(key: string) {
  const tree = await refreshDatasetRecord(key);
  for (const rec of tree) {
    syncDatasetIntoLiveScreen(rec.key, rec.data);
  }
  return tree[0]!;
}

export async function refreshDueDatasets() {
  const result = await refreshDueDatasetRecords();
  for (const rec of result.refreshed) {
    syncDatasetIntoLiveScreen(rec.key, rec.data);
  }
  if (result.refreshed.length > 0) {
    const state = getScreen();
    if (state.definition) persistScreen(state);
  }
  return {
    refreshed: result.refreshed.map((r) => r.key),
    failed: result.failed,
    skipped: result.skipped,
  };
}

export function deleteDataset(key: string): { deleted: string } {
  deleteDatasetFile(key);
  const state = getScreen();
  if (key in state.inlineData) {
    const inlineData = { ...state.inlineData };
    delete inlineData[key];
    persistScreen({ ...state, inlineData });
  }
  return { deleted: key };
}

export function getCarousel(): CarouselState {
  ensureDirs();
  if (!existsSync(carouselPath())) return emptyCarousel();
  try {
    const raw = JSON.parse(readFileSync(carouselPath(), "utf8")) as Partial<CarouselState>;
    return normalizeCarousel(raw);
  } catch {
    return emptyCarousel();
  }
}

function normalizeCarousel(raw: Partial<CarouselState> | null | undefined): CarouselState {
  const base = emptyCarousel();
  if (!raw || typeof raw !== "object") return base;
  const transition =
    typeof raw.transition === "string" && (CAROUSEL_TRANSITIONS as readonly string[]).includes(raw.transition)
      ? (raw.transition as CarouselTransition)
      : base.transition;
  let viewIds: string[] | null = null;
  if (Array.isArray(raw.viewIds)) {
    const ids = raw.viewIds.map((id) => String(id)).filter(Boolean);
    viewIds = ids.length ? ids : null;
  }
  const intervalSec =
    typeof raw.intervalSec === "number" && Number.isFinite(raw.intervalSec)
      ? Math.min(MAX_CAROUSEL_INTERVAL_SEC, Math.max(MIN_CAROUSEL_INTERVAL_SEC, Math.floor(raw.intervalSec)))
      : base.intervalSec;
  return {
    enabled: !!raw.enabled,
    viewIds,
    intervalSec,
    transition,
  };
}

export function setCarousel(input: {
  enabled: boolean;
  views?: string[] | null;
  intervalSec?: number;
  transition?: CarouselTransition;
}): CarouselState {
  const current = getCarousel();
  const index = readViewsIndex();
  const known = new Set(index.map((v) => v.id));

  let viewIds: string[] | null = current.viewIds;
  if (input.views !== undefined) {
    if (input.views === null || input.views.length === 0) {
      viewIds = null;
    } else {
      const missing = input.views.filter((id) => !known.has(id));
      if (missing.length) throw new Error(`Unknown view id(s): ${missing.join(", ")}`);
      viewIds = [...new Set(input.views.map(String))];
    }
  }

  if (input.enabled) {
    const pool = viewIds ? viewIds : index.map((v) => v.id);
    if (pool.length < 2) {
      throw new Error("Carousel needs at least 2 saved views (pass views: [id,…] or save more views)");
    }
  }

  const next = normalizeCarousel({
    enabled: input.enabled,
    viewIds,
    intervalSec: input.intervalSec ?? current.intervalSec,
    transition: input.transition ?? current.transition,
  });
  writeAtomic(carouselPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** Flip enabled; keeps viewIds / interval / transition. Throws if enabling with fewer than 2 views. */
export function toggleCarousel(): CarouselState {
  const current = getCarousel();
  return setCarousel({ enabled: !current.enabled });
}

/** Cycle fade → slide → scale → fade (works while off; updates preference). */
export function cycleCarouselTransition(): CarouselState {
  const current = getCarousel();
  const idx = CAROUSEL_TRANSITIONS.indexOf(current.transition);
  const next = CAROUSEL_TRANSITIONS[(idx + 1) % CAROUSEL_TRANSITIONS.length]!;
  return setCarousel({ enabled: current.enabled, transition: next });
}

/** Adjust interval by delta seconds (clamped 3–600). */
export function bumpCarouselInterval(deltaSec: number): CarouselState {
  const current = getCarousel();
  const delta = Math.trunc(deltaSec);
  if (!delta) return current;
  return setCarousel({
    enabled: current.enabled,
    intervalSec: current.intervalSec + delta,
  });
}

export { listDatasets, getDataset, upsertDataset, summarizeDataset };

export { COMPONENT_TYPES };
