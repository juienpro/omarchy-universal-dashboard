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
  normalizeOverlayChrome,
  overlayDockEdge,
  type IrNode,
  type ViewIr,
  type Placement,
  type ScreenLayout,
  type OverlayAnchor,
  type OverlayMode,
  type OverlaySize,
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
  overlayFilePath,
  overlaysIndexPath,
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
  /** Overlays matching the active view (or globals when activeViewId is null). Derived on read/write. */
  overlays: SavedOverlay[];
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

export type SavedOverlayMeta = {
  id: string;
  slug: string;
  title: string;
  mode: OverlayMode;
  anchor: OverlayAnchor;
  /** null = all views; otherwise only these view UUIDs */
  viewIds: string[] | null;
  updatedAt: string;
};

export type SavedOverlay = SavedOverlayMeta & {
  width?: OverlaySize;
  height?: OverlaySize;
  opacity: number;
  order: number;
  definition: ViewIr;
  layout: ScreenLayout;
};

export type WidgetSpec = {
  id: string;
  type: ComponentType;
  props?: Record<string, unknown>;
  data?: unknown;
  /** Button click handler (`on.click`). */
  on?: { click?: { action: string; [k: string]: unknown } };
  /** Nested widgets (e.g. HorizontalTiles template). Flattened into definition.nodes. */
  children?: WidgetSpec[];
};

export { stateDir, screenPath, viewsIndexPath, carouselPath, overlaysIndexPath };

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
    overlays: [],
    updatedAt: nowIso(),
  };
}

function addBoundKeysFromDefinition(definition: ViewIr | null, keys: Set<string>) {
  if (!definition) return;
  for (const k of definition.datasets ?? []) keys.add(k);
  for (const node of Object.values(definition.nodes)) {
    const props = (node as { props?: Record<string, unknown> }).props;
    const ds = props && typeof props.dataset === "string" ? props.dataset : null;
    if (ds) keys.add(ds);
  }
}

function boundDatasetKeys(definition: ViewIr | null, overlays: SavedOverlay[] = []): string[] {
  const keys = new Set<string>();
  addBoundKeysFromDefinition(definition, keys);
  for (const overlay of overlays) addBoundKeysFromDefinition(overlay.definition, keys);
  return [...keys];
}

/** Overlays visible for the current active view. `viewIds: null` = all views (and empty screen). */
export function matchingOverlays(activeViewId: string | null): SavedOverlay[] {
  const all = listOverlays().map((meta) => getOverlay(meta.id)).filter((o): o is SavedOverlay => !!o);
  const matched = all.filter((o) => {
    if (o.viewIds === null) return true;
    if (!activeViewId) return false;
    return o.viewIds.includes(activeViewId);
  });
  return matched.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

function withMatchedOverlays(state: ScreenState): ScreenState {
  return { ...state, overlays: matchingOverlays(state.activeViewId) };
}

/** Merge persisted dataset caches into inlineData; keep ephemeral _screen.* / _url.*. */
export function hydrateScreenFromDatasets(state: ScreenState): ScreenState {
  const withOverlays = withMatchedOverlays(state);
  const ephemeral: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(withOverlays.inlineData)) {
    if (isEphemeralDatasetKey(k)) ephemeral[k] = v;
  }
  const cached = cacheForKeys(boundDatasetKeys(withOverlays.definition, withOverlays.overlays));
  return { ...withOverlays, inlineData: { ...ephemeral, ...cached } };
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
      overlays: [],
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

/** Re-write screen.json so QML picks up overlay / dataset changes for the active view. */
export function syncScreenOverlays(): ScreenState {
  return persistScreen(getScreen());
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
  if (spec.on !== undefined) {
    base.on = spec.on;
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
    if (node.type === "Button" && node.on?.click?.action === "dataset.refresh") {
      bound.add(node.on.click.dataset);
    }
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

export type WidgetLayoutInput = {
  column?: number;
  index?: number;
  colspan?: number;
  align?: Placement["align"];
};

export type WidgetPatchOp =
  | { op: "upsert"; widget: WidgetSpec; layout?: WidgetLayoutInput }
  | { op: "remove"; id: string }
  | { op: "replace_all"; items: Array<{ widget: WidgetSpec; layout?: WidgetLayoutInput }> }
  | { op: "clear" };

function emptyDefinition(title: string): ViewIr {
  return parseScreenDefinition(
    {
      irVersion: 1,
      title,
      root: "screen-root",
      nodes: {
        "screen-root": { type: "Stack", props: { gap: "md" }, children: [] },
      },
    },
    {},
  );
}

function normalizeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error("Invalid slug");
  return slug;
}

function prepareWidget(
  inlineData: Record<string, unknown>,
  widget: WidgetSpec,
): { widget: WidgetSpec; inlineData: Record<string, unknown> } {
  const applied = applyInlineData(inlineData, widget);
  const props = { ...(widget.props ?? {}) };
  if (applied.datasetKey && !props.dataset) props.dataset = applied.datasetKey;

  const boundKey = typeof props.dataset === "string" ? props.dataset : null;
  if (boundKey && isPersistedDatasetKey(boundKey) && !getDataset(boundKey)) {
    throw new Error(
      `Dataset "${boundKey}" not found. Call ud_datasets_upsert (+ ud_datasets_refresh) before binding Stat/Table/HorizontalTiles.`,
    );
  }

  if (
    (widget.type === "HorizontalTiles" || widget.type === "Repeat") &&
    !(widget.children && widget.children.length > 0)
  ) {
    throw new Error(
      `HorizontalTiles "${widget.id}" needs children[] (template stamped per dataset row). Example: Stack with Icon+Text inside.`,
    );
  }

  if (widget.id === "screen-root") {
    throw new Error('Widget id "screen-root" is reserved');
  }

  return { widget: { ...widget, props }, inlineData: applied.inlineData };
}

function applyGridToLayout(
  layout: ScreenLayout,
  gridInput: { columns?: number; visible?: boolean },
): ScreenLayout {
  const grid = normalizeGrid({
    columns: gridInput.columns ?? layout.grid.columns,
    visible: gridInput.visible ?? layout.grid.visible,
  });
  const placements: Record<string, Placement> = {};
  for (const [id, p] of Object.entries(layout.placements)) {
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
  return normalizeScreenLayout({ grid, placements, themeId: layout.themeId });
}

type MutableDoc = {
  definition: ViewIr;
  layout: ScreenLayout;
  inlineData: Record<string, unknown>;
};

/** Agent upserts attach under the view root (placement targets). Nested ids live inside widget.children. */
function upsertWidgetIntoDoc(doc: MutableDoc, widgetIn: WidgetSpec, layoutIn?: WidgetLayoutInput): MutableDoc {
  const { widget, inlineData } = prepareWidget(doc.inlineData, widgetIn);
  const treeNodes = flattenWidgetTree(widget);
  const root = doc.definition.nodes[doc.definition.root];
  if (!root || !("children" in root)) {
    throw new Error("View root cannot accept children");
  }

  const drop = doc.definition.nodes[widget.id]
    ? collectSubtreeIds(doc.definition.nodes, widget.id)
    : new Set<string>();

  const placement = resolveShowPlacement(
    doc.layout.grid,
    {
      column: layoutIn?.column,
      index: layoutIn?.index,
      colspan: layoutIn?.colspan,
      align: layoutIn?.align,
    },
    { isFirst: root.children.length === 0 && !doc.definition.nodes[widget.id] },
  );

  const nodes: Record<string, IrNode> = {};
  for (const [id, n] of Object.entries(doc.definition.nodes)) {
    if (!drop.has(id)) nodes[id] = n;
  }
  Object.assign(nodes, treeNodes);

  // Detach from any previous parent, then attach under root.
  for (const [id, n] of Object.entries(nodes)) {
    if (id === doc.definition.root || !("children" in n) || !Array.isArray(n.children)) continue;
    if (!n.children.includes(widget.id)) continue;
    nodes[id] = { ...n, children: n.children.filter((c) => c !== widget.id) } as IrNode;
  }

  const rootNow = nodes[doc.definition.root] as IrNode & { children: string[] };
  const kept = rootNow.children.filter((c) => c === widget.id || !drop.has(c));
  nodes[doc.definition.root] = {
    ...rootNow,
    children: kept.includes(widget.id) ? kept : [...kept, widget.id],
  } as IrNode;

  const definition = parseScreenDefinition({ ...doc.definition, nodes }, inlineData);
  const placements = { ...doc.layout.placements };
  for (const id of drop) delete placements[id];
  placements[widget.id] = placement;

  return {
    definition,
    inlineData,
    layout: normalizeScreenLayout({
      grid: doc.layout.grid,
      placements,
      themeId: doc.layout.themeId,
    }),
  };
}

function removeWidgetFromDoc(doc: MutableDoc, widgetId: string): MutableDoc {
  if (widgetId === doc.definition.root) {
    throw new Error("Cannot remove the view root");
  }
  if (!doc.definition.nodes[widgetId]) {
    throw new Error(`Widget not found: ${widgetId}`);
  }

  const drop = collectSubtreeIds(doc.definition.nodes, widgetId);
  const nodes: Record<string, IrNode> = {};
  for (const [id, n] of Object.entries(doc.definition.nodes)) {
    if (drop.has(id)) continue;
    if ("children" in n && Array.isArray(n.children)) {
      nodes[id] = { ...n, children: n.children.filter((c) => !drop.has(c)) } as IrNode;
    } else {
      nodes[id] = n;
    }
  }

  const placements = { ...doc.layout.placements };
  for (const id of drop) delete placements[id];

  const definition = parseScreenDefinition({ ...doc.definition, nodes }, doc.inlineData);
  return {
    definition,
    inlineData: doc.inlineData,
    layout: normalizeScreenLayout({
      grid: doc.layout.grid,
      placements,
      themeId: doc.layout.themeId,
    }),
  };
}

function replaceAllWidgetsInDoc(
  doc: MutableDoc,
  items: Array<{ widget: WidgetSpec; layout?: WidgetLayoutInput }>,
): MutableDoc {
  let inlineData = doc.inlineData;
  const treeNodes: Record<string, IrNode> = {};
  const childIds: string[] = [];
  const placements: Record<string, Placement> = {};
  const seen = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const prepared = prepareWidget(inlineData, item.widget);
    inlineData = prepared.inlineData;
    if (seen.has(prepared.widget.id)) {
      throw new Error(`Duplicate widget id in replace_all: ${prepared.widget.id}`);
    }
    seen.add(prepared.widget.id);
    Object.assign(treeNodes, flattenWidgetTree(prepared.widget));
    childIds.push(prepared.widget.id);
    placements[prepared.widget.id] = resolveShowPlacement(
      doc.layout.grid,
      {
        column: item.layout?.column,
        index: item.layout?.index,
        colspan: item.layout?.colspan,
        align: item.layout?.align,
      },
      { isFirst: i === 0 },
    );
  }

  const definition = parseScreenDefinition(
    {
      irVersion: 1,
      title: doc.definition.title,
      root: "screen-root",
      nodes: {
        "screen-root": { type: "Stack", props: { gap: "md" }, children: childIds },
        ...treeNodes,
      },
    },
    inlineData,
  );

  return {
    definition,
    inlineData,
    layout: normalizeScreenLayout({
      grid: doc.layout.grid,
      placements,
      themeId: doc.layout.themeId,
    }),
  };
}

function clearWidgetsInDoc(doc: MutableDoc): MutableDoc {
  return replaceAllWidgetsInDoc(doc, []);
}

function applyWidgetOp(doc: MutableDoc, op: WidgetPatchOp): MutableDoc {
  switch (op.op) {
    case "upsert":
      return upsertWidgetIntoDoc(doc, op.widget, op.layout);
    case "remove":
      return removeWidgetFromDoc(doc, op.id);
    case "replace_all":
      return replaceAllWidgetsInDoc(doc, op.items);
    case "clear":
      return clearWidgetsInDoc(doc);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown widgets op: ${(_exhaustive as WidgetPatchOp).op}`);
    }
  }
}

function writeViewFile(view: SavedView): void {
  writeAtomic(viewFilePath(view.id), JSON.stringify(view, null, 2) + "\n");
}

function upsertViewIndex(meta: SavedViewMeta): void {
  const index = readViewsIndex();
  const next = index.some((v) => v.id === meta.id)
    ? index.map((v) => (v.id === meta.id ? meta : v))
    : [...index, meta];
  writeViewsIndex(next);
}

function syncActiveScreenFromView(view: SavedView, inlineData: Record<string, unknown>): void {
  const state = getScreen();
  if (state.activeViewId !== view.id) return;
  persistScreen({
    definition: view.definition,
    layout: view.layout,
    inlineData,
    activeViewId: view.id,
    overlays: [],
    updatedAt: nowIso(),
  });
}

export function createView(input: { slug: string; title?: string }): SavedView {
  const slug = normalizeSlug(input.slug);
  const index = readViewsIndex();
  if (index.some((v) => v.slug === slug)) {
    throw new Error(`View slug already exists: ${slug}`);
  }
  const title = input.title?.trim() || slug;
  const id = randomUUID();
  const updatedAt = nowIso();
  const saved: SavedView = {
    id,
    slug,
    title,
    updatedAt,
    definition: emptyDefinition(title),
    layout: defaultLayout(),
  };
  writeViewFile(saved);
  upsertViewIndex({ id, slug, title, updatedAt });
  return saved;
}

export function summarizeView(view: SavedView) {
  return {
    id: view.id,
    slug: view.slug,
    title: view.title,
    updatedAt: view.updatedAt,
    definition: view.definition,
    layout: view.layout,
  };
}

export function patchView(input: {
  id: string;
  slug?: string;
  title?: string;
  grid?: { columns?: number; visible?: boolean };
  widgets?: WidgetPatchOp;
}): SavedView {
  const view = getView(input.id);
  if (!view) throw new Error(`View not found: ${input.id}`);

  let slug = view.slug;
  if (input.slug !== undefined) {
    slug = normalizeSlug(input.slug);
    const clash = readViewsIndex().find((v) => v.slug === slug && v.id !== view.id);
    if (clash) throw new Error(`View slug already exists: ${slug}`);
  }

  const title = input.title !== undefined ? input.title.trim() || slug : view.title;

  let doc: MutableDoc = {
    definition: view.definition,
    layout: view.layout,
    inlineData: {},
  };
  const screen = getScreen();
  if (screen.activeViewId === view.id) {
    doc = { ...doc, inlineData: screen.inlineData };
  }

  if (title !== doc.definition.title) {
    doc = {
      ...doc,
      definition: parseViewIr({ ...doc.definition, title }),
    };
  }

  if (input.grid) {
    doc = { ...doc, layout: applyGridToLayout(doc.layout, input.grid) };
  }

  if (input.widgets) {
    doc = applyWidgetOp(doc, input.widgets);
  }

  const updatedAt = nowIso();
  const saved: SavedView = {
    id: view.id,
    slug,
    title,
    updatedAt,
    definition: doc.definition.title === title ? doc.definition : parseViewIr({ ...doc.definition, title }),
    layout: doc.layout,
  };
  writeViewFile(saved);
  upsertViewIndex({ id: saved.id, slug: saved.slug, title: saved.title, updatedAt });
  syncActiveScreenFromView(saved, doc.inlineData);
  return saved;
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

export function deleteView(id: string): { deleted: string; cleared: boolean } {
  const view = getView(id);
  if (!view) throw new Error(`View not found: ${id}`);
  const path = viewFilePath(id);
  if (existsSync(path)) unlinkSync(path);
  writeViewsIndex(readViewsIndex().filter((v) => v.id !== id));
  detachViewFromOverlays(id);
  const state = getScreen();
  if (state.activeViewId === id) {
    clearScreen();
    return { deleted: id, cleared: true };
  }
  syncScreenOverlays();
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
    overlays: [],
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
    overlays: state.overlays.map(summarizeOverlay),
    updatedAt: state.updatedAt,
    inlineData,
  };
}

function syncDatasetIntoLiveScreen(key: string, data: unknown) {
  const state = getScreen();
  const keys = boundDatasetKeys(state.definition, state.overlays);
  if (!keys.includes(key)) return;
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
    if (state.definition || state.overlays.length > 0) persistScreen(state);
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

// --- Overlays ----------------------------------------------------------------

function readOverlaysIndex(): SavedOverlayMeta[] {
  ensureDirs();
  if (!existsSync(overlaysIndexPath())) return [];
  try {
    const raw = JSON.parse(readFileSync(overlaysIndexPath(), "utf8"));
    return Array.isArray(raw.overlays) ? raw.overlays : [];
  } catch {
    return [];
  }
}

function writeOverlaysIndex(overlays: SavedOverlayMeta[]) {
  writeAtomic(overlaysIndexPath(), JSON.stringify({ overlays }, null, 2) + "\n");
}

function writeOverlayFile(overlay: SavedOverlay): void {
  writeAtomic(overlayFilePath(overlay.id), JSON.stringify(overlay, null, 2) + "\n");
}

function upsertOverlayIndex(meta: SavedOverlayMeta): void {
  const index = readOverlaysIndex();
  const next = index.some((o) => o.id === meta.id)
    ? index.map((o) => (o.id === meta.id ? meta : o))
    : [...index, meta];
  writeOverlaysIndex(next);
}

function overlayMetaOf(overlay: SavedOverlay): SavedOverlayMeta {
  return {
    id: overlay.id,
    slug: overlay.slug,
    title: overlay.title,
    mode: overlay.mode,
    anchor: overlay.anchor,
    viewIds: overlay.viewIds,
    updatedAt: overlay.updatedAt,
  };
}

function normalizeOverlayViews(views: string[] | null | undefined): string[] | null {
  if (views === undefined) return null;
  if (views === null || views.length === 0) return null;
  const known = new Set(listViews().map((v) => v.id));
  const missing = views.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`Unknown view id(s): ${missing.join(", ")}`);
  return [...new Set(views.map(String))];
}

function assertOverlayChrome(mode: OverlayMode, anchor: OverlayAnchor) {
  normalizeOverlayChrome({ mode, anchor, opacity: 1, order: 0 });
  if (mode === "dock" && !overlayDockEdge(anchor)) {
    throw new Error(`Dock overlay anchor "${anchor}" has no edge (use top/bottom/left/right or a corner)`);
  }
}

export function listOverlays(): SavedOverlayMeta[] {
  return readOverlaysIndex();
}

export function getOverlay(id: string): SavedOverlay | null {
  const path = overlayFilePath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SavedOverlay;
    const chrome = normalizeOverlayChrome({
      mode: raw.mode,
      anchor: raw.anchor,
      width: raw.width,
      height: raw.height,
      opacity: raw.opacity ?? 1,
      order: raw.order ?? 0,
    });
    return {
      ...raw,
      mode: chrome.mode,
      anchor: chrome.anchor,
      width: chrome.width,
      height: chrome.height,
      opacity: chrome.opacity,
      order: chrome.order,
      viewIds: Array.isArray(raw.viewIds)
        ? raw.viewIds.length
          ? raw.viewIds.map(String)
          : []
        : null,
      layout: normalizeScreenLayout(raw.layout ?? defaultLayout()),
    };
  } catch {
    return null;
  }
}

export function summarizeOverlay(overlay: SavedOverlay) {
  return {
    id: overlay.id,
    slug: overlay.slug,
    title: overlay.title,
    mode: overlay.mode,
    anchor: overlay.anchor,
    width: overlay.width,
    height: overlay.height,
    opacity: overlay.opacity,
    order: overlay.order,
    viewIds: overlay.viewIds,
    updatedAt: overlay.updatedAt,
    definition: overlay.definition,
    layout: overlay.layout,
  };
}

export function createOverlay(input: {
  slug: string;
  title?: string;
  mode: OverlayMode;
  anchor: OverlayAnchor;
  width?: OverlaySize;
  height?: OverlaySize;
  opacity?: number;
  order?: number;
  views?: string[] | null;
}): SavedOverlay {
  const slug = normalizeSlug(input.slug);
  const index = readOverlaysIndex();
  if (index.some((o) => o.slug === slug)) {
    throw new Error(`Overlay slug already exists: ${slug}`);
  }
  assertOverlayChrome(input.mode, input.anchor);
  const chrome = normalizeOverlayChrome({
    mode: input.mode,
    anchor: input.anchor,
    width: input.width,
    height: input.height,
    opacity: input.opacity ?? 1,
    order: input.order ?? 0,
  });
  const title = input.title?.trim() || slug;
  const id = randomUUID();
  const updatedAt = nowIso();
  const saved: SavedOverlay = {
    id,
    slug,
    title,
    mode: chrome.mode,
    anchor: chrome.anchor,
    width: chrome.width,
    height: chrome.height,
    opacity: chrome.opacity,
    order: chrome.order,
    viewIds: normalizeOverlayViews(input.views ?? null),
    updatedAt,
    definition: emptyDefinition(title),
    layout: defaultLayout(),
  };
  writeOverlayFile(saved);
  upsertOverlayIndex(overlayMetaOf(saved));
  syncScreenOverlays();
  return saved;
}

export function patchOverlay(input: {
  id: string;
  slug?: string;
  title?: string;
  mode?: OverlayMode;
  anchor?: OverlayAnchor;
  width?: OverlaySize | null;
  height?: OverlaySize | null;
  opacity?: number;
  order?: number;
  views?: string[] | null;
  grid?: { columns?: number; visible?: boolean };
  widgets?: WidgetPatchOp;
}): SavedOverlay {
  const overlay = getOverlay(input.id);
  if (!overlay) throw new Error(`Overlay not found: ${input.id}`);

  let slug = overlay.slug;
  if (input.slug !== undefined) {
    slug = normalizeSlug(input.slug);
    const clash = readOverlaysIndex().find((o) => o.slug === slug && o.id !== overlay.id);
    if (clash) throw new Error(`Overlay slug already exists: ${slug}`);
  }

  const title = input.title !== undefined ? input.title.trim() || slug : overlay.title;
  const mode = input.mode ?? overlay.mode;
  const anchor = input.anchor ?? overlay.anchor;
  assertOverlayChrome(mode, anchor);

  const width =
    input.width === null ? undefined : input.width !== undefined ? input.width : overlay.width;
  const height =
    input.height === null ? undefined : input.height !== undefined ? input.height : overlay.height;

  const chrome = normalizeOverlayChrome({
    mode,
    anchor,
    width,
    height,
    opacity: input.opacity ?? overlay.opacity,
    order: input.order ?? overlay.order,
  });

  const viewIds =
    input.views !== undefined ? normalizeOverlayViews(input.views) : overlay.viewIds;

  let doc: MutableDoc = {
    definition: overlay.definition,
    layout: overlay.layout,
    inlineData: {},
  };
  const screen = getScreen();
  if (screen.overlays.some((o) => o.id === overlay.id)) {
    doc = { ...doc, inlineData: screen.inlineData };
  }

  if (title !== doc.definition.title) {
    doc = {
      ...doc,
      definition: parseViewIr({ ...doc.definition, title }),
    };
  }

  if (input.grid) {
    doc = { ...doc, layout: applyGridToLayout(doc.layout, input.grid) };
  }

  if (input.widgets) {
    doc = applyWidgetOp(doc, input.widgets);
  }

  const updatedAt = nowIso();
  const saved: SavedOverlay = {
    id: overlay.id,
    slug,
    title,
    mode: chrome.mode,
    anchor: chrome.anchor,
    width: chrome.width,
    height: chrome.height,
    opacity: chrome.opacity,
    order: chrome.order,
    viewIds,
    updatedAt,
    definition: doc.definition.title === title ? doc.definition : parseViewIr({ ...doc.definition, title }),
    layout: doc.layout,
  };
  writeOverlayFile(saved);
  upsertOverlayIndex(overlayMetaOf(saved));
  syncScreenOverlays();
  return saved;
}

export function deleteOverlay(id: string): { deleted: string } {
  const overlay = getOverlay(id);
  if (!overlay) throw new Error(`Overlay not found: ${id}`);
  const path = overlayFilePath(id);
  if (existsSync(path)) unlinkSync(path);
  writeOverlaysIndex(readOverlaysIndex().filter((o) => o.id !== id));
  syncScreenOverlays();
  return { deleted: id };
}

function detachViewFromOverlays(viewId: string): void {
  for (const meta of readOverlaysIndex()) {
    const overlay = getOverlay(meta.id);
    if (!overlay || !overlay.viewIds || !overlay.viewIds.includes(viewId)) continue;
    const viewIds = overlay.viewIds.filter((id) => id !== viewId);
    const next: SavedOverlay = {
      ...overlay,
      viewIds: viewIds.length ? viewIds : [],
      updatedAt: nowIso(),
    };
    writeOverlayFile(next);
    upsertOverlayIndex(overlayMetaOf(next));
  }
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
