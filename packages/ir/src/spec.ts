import { zodToJsonSchema } from "zod-to-json-schema";
import {
  COMPONENT_TYPES,
  nodeBody,
  type ComponentType,
} from "./components.js";

/** Widgets the Quickshell panel actually draws today. */
export const RENDERED_WIDGET_TYPES = [
  "Stack",
  "Group",
  "Grid",
  "Container",
  "Panel",
  "Card",
  "ScrollArea",
  "Title",
  "Text",
  "Markdown",
  "Icon",
  "Badge",
  "Stat",
  "Divider",
  "Table",
  "HorizontalTiles",
] as const satisfies readonly ComponentType[];

/** IR types accepted by MCP but shown as placeholders in the panel. */
export const PLACEHOLDER_WIDGET_TYPES = [
  "Chart",
  "Map",
  "List",
  "Timeline",
  "Image",
  "Button",
  "Repeat",
  "Anchor",
] as const satisfies readonly ComponentType[];

export type WidgetSpecEntry = {
  type: ComponentType;
  /** Drawn in the Omarchy panel (not a placeholder). */
  rendered: boolean;
  /** Legacy alias — prefer HorizontalTiles. */
  legacy?: boolean;
  /** JSON Schema for this IR node (type + props + children when applicable). */
  schema: Record<string, unknown>;
};

function nodeSchemaForType(type: ComponentType): Record<string, unknown> {
  const opt = nodeBody.options.find((o) => o.shape.type.value === type);
  if (!opt) throw new Error(`Unknown widget type: ${type}`);
  const raw = zodToJsonSchema(opt, {
    $refStrategy: "none",
    name: type,
  }) as Record<string, unknown>;
  // zod-to-json-schema may wrap under definitions/name
  if (raw.definitions && typeof raw.definitions === "object") {
    const def = (raw.definitions as Record<string, unknown>)[type];
    if (def && typeof def === "object") return def as Record<string, unknown>;
  }
  return raw;
}

/**
 * Full widget IR specs for agents (props, enums, nested fields).
 * Source of truth = Zod schemas in components.ts.
 */
export function widgetsSpec(filterType?: string): {
  widgets: WidgetSpecEntry[];
  placement: {
    note: string;
    column: string;
    index: string;
    colspan: string;
  };
} {
  const rendered = new Set<string>(RENDERED_WIDGET_TYPES);
  const types = filterType
    ? COMPONENT_TYPES.filter((t) => t === filterType)
    : COMPONENT_TYPES.filter((t) => t !== "Repeat"); // prefer HorizontalTiles; Repeat still in schema via type filter

  if (filterType && types.length === 0) {
    throw new Error(
      `Unknown widget type: ${filterType}. Valid: ${COMPONENT_TYPES.join(", ")}`,
    );
  }

  // If explicitly asking for Repeat, include it
  const list =
    filterType === "Repeat" ? (["Repeat"] as ComponentType[]) : (types as ComponentType[]);

  const widgets: WidgetSpecEntry[] = list.map((type) => ({
    type,
    rendered: rendered.has(type),
    ...(type === "Repeat" ? { legacy: true as const } : {}),
    schema: nodeSchemaForType(type),
  }));

  return {
    widgets,
    placement: {
      note: "Top-level on ud_screen_show (sibling of widget), not inside props.",
      column: "1-based start column (1..grid.columns)",
      index: "0-based row band (same index = same horizontal row)",
      colspan: "width in columns (default 1)",
    },
  };
}
