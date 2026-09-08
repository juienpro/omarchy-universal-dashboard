import { DEFAULT_THEME_ID, normalizeThemeId, type ThemeId } from "./themes.js";

/** Screen placement: N columns, colspan, horizontal-first auto-flow or explicit column+index. */

export const MAX_COLUMNS = 26;
export const DEFAULT_GRID = { columns: 3, visible: false as boolean };

export type ScreenGrid = {
  columns: number;
  visible: boolean;
};

export type CellAlign = "start" | "center" | "end";

export type Placement = {
  /** Width in columns (default 1). */
  colspan?: number;
  /** 1-based start column. Omit for horizontal-first auto placement. */
  column?: number;
  /** 0-based row (shared across columns). Same index → same band. Requires column. */
  index?: number;
  align?: CellAlign;
};

export type ScreenLayout = {
  grid: ScreenGrid;
  placements: Record<string, Placement>;
  /** Kiosk theme id (see THEME_IDS). Persisted with saved views. */
  themeId?: ThemeId;
};

export type ResolvedPosition = {
  id: string;
  colStart: number;
  colspan: number;
  row: number;
};

type LegacyPlacement = {
  origin?: string;
  colSpan?: number;
  rowSpan?: number;
  align?: CellAlign;
  colspan?: number;
  column?: number;
  index?: number;
};

type LegacyGrid = {
  cols?: number;
  rows?: number;
  columns?: number;
  visible?: boolean;
};

function parseLegacyCell(cell: string): { col: number; row: number } {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(cell.trim());
  if (!m) return { col: 0, row: 1 };
  return { col: m[1]!.toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) };
}

export function normalizeGrid(input?: Partial<ScreenGrid> | LegacyGrid | null): ScreenGrid {
  const legacy = input as LegacyGrid | null | undefined;
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor(legacy?.columns ?? legacy?.cols ?? DEFAULT_GRID.columns)),
  );
  return {
    columns,
    visible: Boolean(legacy?.visible ?? DEFAULT_GRID.visible),
  };
}

export function normalizePlacement(input?: LegacyPlacement | Placement | null): Placement {
  if (!input || typeof input !== "object") return {};
  if ("origin" in input && typeof input.origin === "string") {
    const { col, row } = parseLegacyCell(input.origin);
    return {
      colspan: input.colSpan ?? input.colspan ?? 1,
      column: col + 1,
      index: Math.max(0, row - 1),
      align: input.align,
    };
  }
  const p = input as Placement;
  return {
    colspan: p.colspan,
    column: p.column,
    index: p.index,
    align: p.align,
  };
}

export function readScreenLayout(raw: unknown): ScreenLayout {
  const obj = (raw && typeof raw === "object" ? raw : {}) as {
    grid?: Partial<ScreenGrid> | LegacyGrid;
    placements?: Record<string, LegacyPlacement | Placement>;
    themeId?: string;
  };
  const placements: Record<string, Placement> = {};
  if (obj.placements && typeof obj.placements === "object") {
    for (const [id, p] of Object.entries(obj.placements)) {
      placements[id] = normalizePlacement(p);
    }
  }
  const themeId = normalizeThemeId(typeof obj.themeId === "string" ? obj.themeId : undefined);
  return { grid: normalizeGrid(obj.grid), placements, themeId };
}

export function normalizeScreenLayout(input?: Partial<ScreenLayout> | null): ScreenLayout {
  const base = readScreenLayout(input ?? {});
  return {
    grid: base.grid,
    placements: base.placements,
    themeId: normalizeThemeId(base.themeId ?? DEFAULT_THEME_ID),
  };
}

function colspanOf(p: Placement | undefined, columns: number): number {
  return Math.min(columns, Math.max(1, p?.colspan ?? 1));
}

function occupies(occupied: Set<string>, row: number, colStart: number, colspan: number): boolean {
  for (let c = colStart; c < colStart + colspan; c++) {
    if (occupied.has(`${row},${c}`)) return true;
  }
  return false;
}

function mark(occupied: Set<string>, row: number, colStart: number, colspan: number) {
  for (let c = colStart; c < colStart + colspan; c++) {
    occupied.add(`${row},${c}`);
  }
}

function assertColspan(columns: number, colStart: number, colspan: number, id: string) {
  if (colStart < 1 || colStart > columns) {
    throw Object.assign(new Error(`Widget "${id}": column ${colStart} outside 1–${columns}`), { status: 400 });
  }
  if (colspan < 1) {
    throw Object.assign(new Error(`Widget "${id}": colspan must be >= 1`), { status: 400 });
  }
  if (colStart + colspan - 1 > columns) {
    throw Object.assign(
      new Error(`Widget "${id}": column ${colStart} + colspan ${colspan} overflows ${columns} columns`),
      { status: 400 },
    );
  }
}

/** Compute CSS grid positions for root widgets (add order = ids order). */
export function resolveLayoutPositions(
  columns: number,
  ids: string[],
  placements: Record<string, Placement>,
): ResolvedPosition[] {
  const occupied = new Set<string>();
  const results: ResolvedPosition[] = [];
  let autoRow = 1;
  let autoCol = 1;

  for (const id of ids) {
    const p = placements[id] ?? {};
    const colspan = colspanOf(p, columns);

    if (p.column != null) {
      const colStart = p.column;
      assertColspan(columns, colStart, colspan, id);

      // `index` is a 0-based **row** (shared across columns), not “nth widget
      // added to this column”. Same index → same horizontal band, regardless
      // of children[] order. Omit index → first free row in this span.
      let row =
        p.index != null ? Math.max(0, Math.floor(p.index)) + 1 : 1;
      while (occupies(occupied, row, colStart, colspan)) row++;

      mark(occupied, row, colStart, colspan);
      results.push({ id, colStart, colspan, row });
      continue;
    }

    assertColspan(columns, autoCol, colspan, id);
    while (occupies(occupied, autoRow, autoCol, colspan)) {
      autoCol++;
      if (autoCol + colspan - 1 > columns) {
        autoRow++;
        autoCol = 1;
      }
    }

    mark(occupied, autoRow, autoCol, colspan);
    results.push({ id, colStart: autoCol, colspan, row: autoRow });
    autoCol += colspan;
    if (autoCol > columns) {
      autoRow++;
      autoCol = 1;
    }
  }

  return results;
}

export function assertPlacement(columns: number, placement: Placement, id = "widget") {
  const colspan = colspanOf(placement, columns);
  if (placement.column != null) {
    assertColspan(columns, placement.column, colspan, id);
  }
}

/** Default full-width hero (single widget / replace). */
export function heroPlacement(grid: ScreenGrid, align: CellAlign = "center"): Placement {
  return { colspan: grid.columns, align };
}

/** Resolve placement for as_screen_show. */
export function resolveShowPlacement(
  grid: ScreenGrid,
  input: {
    column?: number;
    index?: number;
    colspan?: number;
    align?: CellAlign;
  },
  opts?: { isFirst?: boolean },
): Placement {
  const isFirst = opts?.isFirst ?? false;
  if (input.column == null && input.index == null && input.colspan == null) {
    return isFirst ? heroPlacement(grid, input.align ?? "center") : { align: input.align ?? "start" };
  }
  const placement: Placement = {
    colspan: input.colspan ?? 1,
    column: input.column,
    index: input.index,
    align: input.align ?? (input.column != null ? "start" : "center"),
  };
  assertPlacement(grid.columns, placement);
  return placement;
}

export function defaultPlacement(grid: ScreenGrid): Placement {
  return heroPlacement(grid);
}

/** Saved view without layout: stack root widgets vertically (full width each). */
export function stackRootPlacements(grid: ScreenGrid, ids: string[]): Record<string, Placement> {
  if (ids.length === 0) return {};
  if (ids.length === 1) {
    return { [ids[0]!]: heroPlacement(grid, "start") };
  }
  const placements: Record<string, Placement> = {};
  for (let i = 0; i < ids.length; i++) {
    placements[ids[i]!] = {
      colspan: grid.columns,
      column: 1,
      index: i,
      align: "start",
    };
  }
  return placements;
}

/** Find resolved position for one widget (after full layout pass). */
export function findResolvedPosition(
  columns: number,
  ids: string[],
  placements: Record<string, Placement>,
  id: string,
): ResolvedPosition | undefined {
  return resolveLayoutPositions(columns, ids, placements).find((p) => p.id === id);
}

export function nudgePlacement(
  columns: number,
  ids: string[],
  placements: Record<string, Placement>,
  nodeId: string,
  direction: "left" | "right" | "up" | "down",
): Placement {
  const prev = placements[nodeId] ?? {};
  const resolved = findResolvedPosition(columns, ids, placements, nodeId);
  const colspan = colspanOf(prev, columns);

  const colStart = resolved?.colStart ?? prev.column ?? 1;
  const rowIndex = prev.index ?? (resolved ? resolved.row - 1 : 0);

  if (direction === "left" || direction === "right") {
    const delta = direction === "left" ? -1 : 1;
    const nextCol = colStart + delta;
    if (nextCol < 1 || nextCol + colspan - 1 > columns) {
      throw Object.assign(new Error(`Cannot nudge ${direction} — out of column bounds`), { status: 400 });
    }
    return { ...prev, colspan, column: nextCol, index: rowIndex, align: prev.align };
  }

  const nextIndex = direction === "up" ? rowIndex - 1 : rowIndex + 1;
  if (nextIndex < 0) {
    throw Object.assign(new Error("Cannot nudge up — already at top of column"), { status: 400 });
  }
  return { ...prev, colspan, column: colStart, index: nextIndex, align: prev.align };
}
