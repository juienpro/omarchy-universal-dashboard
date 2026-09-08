export { COMPONENT_TYPES, chartKind, clickAction, irNode, nodeId, nodeBody, sizeToken, iconSizeToken } from "./components.js";
export type { ChartKind, ClickAction, ComponentType, IrNode, SizeToken, IconSizeToken } from "./components.js";

export {
  PLACEHOLDER_WIDGET_TYPES,
  RENDERED_WIDGET_TYPES,
  widgetsSpec,
} from "./spec.js";
export type { WidgetSpecEntry } from "./spec.js";

export { inspectView, parseViewIr, viewIr } from "./view.js";
export type { ViewIr } from "./view.js";

export { PatchError, applyPatch, patchOp } from "./patch.js";
export type { PatchOp } from "./patch.js";

export {
  DEFAULT_GRID,
  MAX_COLUMNS,
  findResolvedPosition,
  heroPlacement,
  normalizeGrid,
  normalizePlacement,
  normalizeScreenLayout,
  nudgePlacement,
  readScreenLayout,
  resolveLayoutPositions,
  resolveShowPlacement,
  stackRootPlacements,
  assertPlacement,
  defaultPlacement,
} from "./layout.js";
export type { CellAlign, Placement, ResolvedPosition, ScreenGrid, ScreenLayout } from "./layout.js";

export {
  DEFAULT_THEME_ID,
  THEME_CATALOG,
  THEME_IDS,
  isThemeId,
  nextThemeId,
  normalizeThemeId,
  resolveTextColorToken,
  TEXT_COLOR_TOKENS,
} from "./themes.js";
export type { TextColorToken, ThemeId, ThemeMeta } from "./themes.js";
