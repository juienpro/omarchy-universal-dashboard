import { z } from "zod";

export const OVERLAY_MODES = ["float", "dock"] as const;
export type OverlayMode = (typeof OVERLAY_MODES)[number];

/** Anchor on the panel. `dock` mode only allows edge-derived anchors (not bare `center`). */
export const OVERLAY_ANCHORS = [
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
  "center-left",
  "center-right",
] as const;
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number];

export const OVERLAY_DOCK_EDGES = ["top", "bottom", "left", "right"] as const;
export type OverlayDockEdge = (typeof OVERLAY_DOCK_EDGES)[number];

/** Size: CSS-like px number, or percentage string of the panel axis (`"100%"`, `"40%"`). */
export const overlaySize = z.union([
  z.number().positive().max(4000),
  z
    .string()
    .regex(/^\d+(\.\d+)?%$/, 'Expected a percentage like "100%" or "40%"'),
]);
export type OverlaySize = z.infer<typeof overlaySize>;

export const overlayChrome = z
  .object({
    mode: z.enum(OVERLAY_MODES),
    anchor: z.enum(OVERLAY_ANCHORS),
    width: overlaySize.optional(),
    height: overlaySize.optional(),
    /** 0–1; mainly useful for `float` (watermarks). */
    opacity: z.number().min(0).max(1).default(1),
    /** Stacking order within the same dock edge / float layer (lower = earlier / further back). */
    order: z.number().int().min(0).max(999).default(0),
  })
  .superRefine((chrome, ctx) => {
    if (chrome.mode === "dock" && chrome.anchor === "center") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dock overlays cannot use anchor "center" (nothing to push against). Use float, or an edge anchor.',
        path: ["anchor"],
      });
    }
  });

export type OverlayChrome = z.infer<typeof overlayChrome>;

/** Map anchor → dock edge for layout. `center` has no edge. */
export function overlayDockEdge(anchor: OverlayAnchor): OverlayDockEdge | null {
  switch (anchor) {
    case "top":
    case "top-left":
    case "top-right":
      return "top";
    case "bottom":
    case "bottom-left":
    case "bottom-right":
      return "bottom";
    case "left":
    case "center-left":
      return "left";
    case "right":
    case "center-right":
      return "right";
    case "center":
      return null;
  }
}

/** Horizontal align within a top/bottom dock strip (or float). */
export function overlayHAlign(anchor: OverlayAnchor): "start" | "center" | "end" {
  switch (anchor) {
    case "top-left":
    case "bottom-left":
    case "left":
    case "center-left":
      return "start";
    case "top-right":
    case "bottom-right":
    case "right":
    case "center-right":
      return "end";
    default:
      return "center";
  }
}

/** Vertical align within a left/right dock strip (or float). */
export function overlayVAlign(anchor: OverlayAnchor): "start" | "center" | "end" {
  switch (anchor) {
    case "top":
    case "top-left":
    case "top-right":
      return "start";
    case "bottom":
    case "bottom-left":
    case "bottom-right":
      return "end";
    default:
      return "center";
  }
}

export function normalizeOverlayChrome(input: unknown): OverlayChrome {
  return overlayChrome.parse(input);
}

/** Resolve size against an axis length in px. Returns null when size is omitted (content-sized). */
export function resolveOverlaySizePx(size: OverlaySize | undefined, axisPx: number): number | null {
  if (size === undefined) return null;
  if (typeof size === "number") return size;
  const pct = parseFloat(size);
  if (!Number.isFinite(pct) || axisPx <= 0) return null;
  return Math.max(1, (axisPx * pct) / 100);
}
