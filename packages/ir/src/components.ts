import { z } from "zod";

export const sizeToken = z.enum(["xs", "sm", "md", "lg", "xl", "2xl"]);
export type SizeToken = z.infer<typeof sizeToken>;

/**
 * Icon-only sizes (px in the panel). Text/Badge/etc. keep `sizeToken`.
 * Same trick as omarchy.weather: glyph Text with raw `font.pixelSize`, not
 * Style.font.displayLarge (~28). `hero` / `2xl` = weather panel’s 64.
 */
export const iconSizeToken = z.enum([
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "hero",
]);
export type IconSizeToken = z.infer<typeof iconSizeToken>;

export const textColor = z.enum([
  "default",
  "muted",
  "primary",
  "text",
  "accent",
  "positive",
  "negative",
  "neutral",
  "warning",
  // legacy aliases (normalized at render time)
  "dimmed",
  "cyan",
  "white",
  "red",
  "green",
  "yellow",
  "orange",
  "magenta",
]);
export type TextColor = z.infer<typeof textColor>;

export const textAlign = z.enum(["left", "center", "right"]);
export type TextAlign = z.infer<typeof textAlign>;

const textStyleProps = {
  weight: z.enum(["normal", "bold"]).optional(),
  italic: z.boolean().optional(),
  color: textColor.optional(),
  align: textAlign.optional(),
};

export const chartKind = z.enum([
  "line",
  "area",
  "bar",
  "barStacked",
  "scatter",
  "pie",
  "donut",
  "heatmap",
  "treemap",
  "radar",
  "gauge",
]);
export type ChartKind = z.infer<typeof chartKind>;

export const nodeId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "Node ids must be lowercase slug-like (e.g. hourly-chart)");

const datasetKey = z.string().min(1).max(128);

export const clickAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dataset.refresh"), dataset: datasetKey }),
  z.object({ action: z.literal("navigate"), viewId: z.string().min(1) }),
  z.object({ action: z.literal("openUrl"), url: z.string().url() }),
  z.object({
    action: z.literal("openDetail"),
    detailKey: z.string().min(1).max(128),
    url: z.string().url(),
  }),
]);
export type ClickAction = z.infer<typeof clickAction>;

const onClick = z.object({ click: clickAction }).optional();

/** Reject unknown keys so harness typos fail loudly instead of being stripped. */
function propsObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export const stackNode = z.object({
  type: z.literal("Stack"),
  props: propsObject({
    gap: sizeToken.optional(),
    align: z.enum(["stretch", "start", "center", "end"]).optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const groupNode = z.object({
  type: z.literal("Group"),
  props: propsObject({
    gap: sizeToken.optional(),
    justify: z.enum(["start", "center", "end", "space-between"]).optional(),
    wrap: z.boolean().optional(),
    grow: z.boolean().optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const gridNode = z.object({
  type: z.literal("Grid"),
  props: propsObject({
    cols: z.number().int().min(1).max(12).default(2),
    gap: sizeToken.optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const containerNode = z.object({
  type: z.literal("Container"),
  props: propsObject({
    size: sizeToken.optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const panelNode = z.object({
  type: z.literal("Panel"),
  props: propsObject({
    padding: sizeToken.optional(),
    withBorder: z.boolean().optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const scrollAreaNode = z.object({
  type: z.literal("ScrollArea"),
  props: propsObject({
    height: z.number().int().min(80).max(2000).optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

export const dividerNode = z.object({
  type: z.literal("Divider"),
  props: propsObject({ label: z.string().optional() }).default({}),
});

export const titleNode = z.object({
  type: z.literal("Title"),
  props: propsObject({
    text: z.string().optional(),
    textField: z.string().optional(),
    order: z.number().int().min(1).max(6).default(2),
    size: sizeToken.optional(),
    ...textStyleProps,
  }),
});

export const textNode = z.object({
  type: z.literal("Text"),
  props: propsObject({
    text: z.string().optional(),
    textField: z.string().optional(),
    c: z.enum(["dimmed", "default"]).optional(),
    size: sizeToken.optional(),
    ...textStyleProps,
  }),
});

export const markdownNode = z.object({
  type: z.literal("Markdown"),
  props: propsObject({ text: z.string() }),
});

export const imageNode = z.object({
  type: z.literal("Image"),
  props: propsObject({
    src: z.string().optional(),
    srcField: z.string().optional(),
    alt: z.string().default(""),
    altField: z.string().optional(),
    height: z.number().int().min(40).max(2000).optional(),
    radius: sizeToken.optional(),
  }),
});

export const badgeNode = z.object({
  type: z.literal("Badge"),
  props: propsObject({
    text: z.string().optional(),
    textField: z.string().optional(),
    color: z.string().optional(),
  }),
});

/** Decorative glyph / emoji / Nerd Font symbol. */
export const iconNode = z.object({
  type: z.literal("Icon"),
  props: propsObject({
    /** Literal glyph or emoji, e.g. "⛅" or a Nerd Font codepoint. */
    glyph: z.string().min(1).max(16).optional(),
    /** Read glyph from a dataset row field (with `dataset`). */
    glyphField: z.string().min(1).optional(),
    dataset: datasetKey.optional(),
    where: z
      .object({
        field: z.string().min(1),
        equals: z.union([z.string(), z.number(), z.boolean()]),
      })
      .optional(),
    /** Icon pixel scale (dedicated; see iconSizeToken). Default md. Prefer hero/3xl+ next to large Stats. */
    size: iconSizeToken.optional(),
    color: textColor.optional(),
    align: textAlign.optional(),
  }),
});

export const statNode = z.object({
  type: z.literal("Stat"),
  props: propsObject({
    label: z.string(),
    /** Optional when stamped inside HorizontalTiles (row comes from parent). */
    dataset: datasetKey.optional(),
    field: z.string().min(1),
    /**
     * Pick a row from an array dataset (otherwise first row / object is used).
     * Example: `{ field: "pair", equals: "EUR/USD" }`.
     */
    where: z
      .object({
        field: z.string().min(1),
        equals: z.union([z.string(), z.number(), z.boolean()]),
      })
      .optional(),
    suffix: z.string().optional(),
    prefix: z.string().optional(),
    /** Dataset field for variation (e.g. daily %). Shown under the main value. */
    changeField: z
      .string()
      .min(1)
      .optional()
      .describe("Numeric variation field shown under the value (e.g. daily %)."),
    /** Static suffix on the change line (e.g. "%"). */
    changeSuffix: z.string().optional().describe('Suffix on the change line, e.g. "%".'),
    /** Color change green/red by sign. Default true when changeField is set. */
    colorizeChange: z
      .boolean()
      .optional()
      .describe("Color the change line green/red by sign (default true when changeField is set)."),
  }),
});

export const listNode = z.object({
  type: z.literal("List"),
  props: propsObject({
    dataset: datasetKey,
    layout: z.enum(["stack", "grid"]).default("stack"),
    cols: z.number().int().min(1).max(8).default(3),
    titleField: z.string().min(1),
    subtitleField: z.string().optional(),
    metaField: z.string().optional(),
    imageField: z.string().optional(),
    hrefField: z.string().optional(),
    /** When set, clicks open this internal detail (on-demand) using hrefField as the item URL. */
    detailKey: z.string().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
});

export const timelineNode = z.object({
  type: z.literal("Timeline"),
  props: propsObject({
    dataset: datasetKey,
    titleField: z.string().min(1),
    timeField: z.string().min(1),
    bodyField: z.string().optional(),
  }),
});

export const cardNode = z.object({
  type: z.literal("Card"),
  props: propsObject({
    padding: sizeToken.optional(),
  }).default({}),
  children: z.array(nodeId).default([]),
});

const horizontalTilesProps = propsObject({
  dataset: datasetKey,
  /** `grid` = horizontal wrap (default). `stack` = vertical list of cells. */
  layout: z.enum(["stack", "grid"]).default("grid"),
  cols: z.number().int().min(1).max(8).default(3),
  gap: sizeToken.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/** Horizontal band/grid of cells — stamps `children` once per dataset row. */
export const horizontalTilesNode = z.object({
  type: z.literal("HorizontalTiles"),
  props: horizontalTilesProps,
  children: z.array(nodeId).default([]),
});

/** @deprecated Use HorizontalTiles. Kept so existing IR still parses. */
export const repeatNode = z.object({
  type: z.literal("Repeat"),
  props: horizontalTilesProps,
  children: z.array(nodeId).default([]),
});

export const tableColumn = propsObject({
  field: z.string().min(1),
  label: z.string().min(1),
  width: z.number().int().min(40).max(800).optional(),
});

export const tableNode = z.object({
  type: z.literal("Table"),
  props: propsObject({
    dataset: datasetKey,
    columns: z.array(tableColumn).min(1),
    pageSize: z.number().int().min(5).max(100).default(20),
    sortable: z.boolean().default(true),
  }),
});

export const chartNode = z.object({
  type: z.literal("Chart"),
  props: propsObject({
    kind: chartKind,
    dataset: datasetKey,
    x: z.string().min(1),
    y: z.array(z.string().min(1)).min(1),
    height: z.number().int().min(120).max(1200).default(280),
  }),
});

export const mapNode = z.object({
  type: z.literal("Map"),
  props: propsObject({
    height: z.number().int().min(120).max(1200).default(360),
    center: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict(),
    zoom: z.number().min(0).max(22).default(10),
    dataset: datasetKey.optional(),
    latField: z.string().optional(),
    lngField: z.string().optional(),
    labelField: z.string().optional(),
  }),
});

export const buttonNode = z.object({
  type: z.literal("Button"),
  props: propsObject({
    label: z.string(),
    variant: z.enum(["filled", "light", "outline", "subtle"]).optional(),
  }),
  on: onClick,
});

export const anchorNode = z.object({
  type: z.literal("Anchor"),
  props: propsObject({
    label: z.string().optional(),
    labelField: z.string().optional(),
    href: z.string().optional(),
    hrefField: z.string().optional(),
  }),
});

export const nodeBody = z.discriminatedUnion("type", [
  stackNode,
  groupNode,
  gridNode,
  containerNode,
  panelNode,
  scrollAreaNode,
  dividerNode,
  titleNode,
  textNode,
  markdownNode,
  imageNode,
  badgeNode,
  iconNode,
  statNode,
  listNode,
  timelineNode,
  cardNode,
  horizontalTilesNode,
  repeatNode,
  tableNode,
  chartNode,
  mapNode,
  buttonNode,
  anchorNode,
]);

export const irNode = nodeBody;
export type IrNode = z.infer<typeof irNode>;
export type ComponentType = IrNode["type"];

export const COMPONENT_TYPES = nodeBody.options.map((opt) => opt.shape.type.value) as ComponentType[];
