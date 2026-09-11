import { z } from "zod";
import {
  COMPONENT_TYPES,
  clearScreen,
  createOverlay,
  createView,
  deleteDataset,
  deleteOverlay,
  deleteView,
  getDataset,
  getOverlay,
  getScreen,
  getView,
  listDatasets,
  listOverlays,
  listViews,
  loadViewOnScreen,
  patchOverlay,
  patchView,
  refreshDataset,
  setCarousel,
  summarizeDataset,
  summarizeOverlay,
  summarizeScreen,
  summarizeView,
  upsertDataset,
  CAROUSEL_TRANSITIONS,
  type WidgetPatchOp,
  type WidgetSpec,
} from "./store.js";
import {
  MAX_COLUMNS,
  OVERLAY_ANCHORS,
  OVERLAY_MODES,
  widgetsSpec,
  type OverlayAnchor,
  type OverlayMode,
  type OverlaySize,
} from "@eow/ir";

const PROTOCOL = "2025-03-26";

type JsonRpcId = string | number | null;
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Prefer Content-Length when the client used it; otherwise newline JSON. */
let useContentLength = false;

function text(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

const widgetSpecSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    type: z.enum(COMPONENT_TYPES as [string, ...string[]]),
    props: z.record(z.unknown()).optional(),
    data: z.unknown().optional(),
    on: z
      .object({
        click: z
          .object({
            action: z.enum(["dataset.refresh", "navigate", "openUrl", "openDetail"]),
          })
          .passthrough()
          .optional(),
      })
      .optional(),
    children: z.array(widgetSpecSchema).optional(),
  }),
);

const layoutSchema = z.object({
  column: z.number().int().min(1).max(MAX_COLUMNS).optional(),
  index: z.number().int().min(0).optional(),
  colspan: z.number().int().min(1).max(MAX_COLUMNS).optional(),
  align: z.enum(["start", "center", "end"]).optional(),
});

const widgetItemSchema = z.object({
  widget: widgetSpecSchema,
  layout: layoutSchema.optional(),
});

const widgetsOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    widget: widgetSpecSchema,
    layout: layoutSchema.optional(),
  }),
  z.object({
    op: z.literal("remove"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("replace_all"),
    items: z.array(widgetItemSchema),
  }),
  z.object({
    op: z.literal("clear"),
  }),
]);

const widgetJsonSchema = {
  type: "object",
  description: "Widget tree. Nested children allowed (HorizontalTiles template).",
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: [...COMPONENT_TYPES] },
    props: { type: "object" },
    data: {},
    on: {
      type: "object",
      description: "Button only: { click: { action, … } }. Actions: openUrl, navigate, dataset.refresh (openDetail unsupported).",
      properties: {
        click: { type: "object" },
      },
    },
    children: {
      type: "array",
      description: "Nested widgets (required for HorizontalTiles — stamped once per dataset row)",
      items: { type: "object" },
    },
  },
  required: ["id", "type"],
};

const layoutJsonSchema = {
  type: "object",
  description: "Screen placement (not inside widget.props). column is 1-based.",
  properties: {
    column: { type: "integer", minimum: 1, maximum: MAX_COLUMNS, description: "1-based start column" },
    index: { type: "integer", minimum: 0, description: "0-based row band" },
    colspan: { type: "integer", minimum: 1, maximum: MAX_COLUMNS },
    align: { type: "string", enum: ["start", "center", "end"] },
  },
};

const tools = [
  {
    name: "ud_view_list",
    description: "List saved views (id, slug, title, updatedAt)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_view_get",
    description: "Read one saved view by UUID (definition + layout). Always pass id — for the live/active panel use ud_screen_get.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "View UUID from ud_view_list" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_view_create",
    description:
      "Create an empty saved view (slug must be unique). Does not change the live screen — call ud_screen_load with the returned id to display it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Unique slug e.g. news" },
        title: { type: "string" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_view_patch",
    description:
      "Patch a saved view by id: optional slug/title rename, grid columns, and/or one widgets op. Widgets ops: upsert (create/replace one widget id + optional layout), remove (by id), replace_all (full items list), clear. Upsert replaces that widget's subtree. Write-through to live screen if this view is active.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "View UUID" },
        slug: { type: "string", description: "Rename slug (must stay unique)" },
        title: { type: "string" },
        grid: {
          type: "object",
          properties: {
            columns: { type: "integer", minimum: 1, maximum: MAX_COLUMNS },
            visible: { type: "boolean", description: "Show column number overlay" },
          },
        },
        widgets: {
          type: "object",
          description: "One widget operation (discriminated by op)",
          properties: {
            op: { type: "string", enum: ["upsert", "remove", "replace_all", "clear"] },
            widget: widgetJsonSchema,
            layout: layoutJsonSchema,
            id: { type: "string", description: "Widget id (remove)" },
            items: {
              type: "array",
              description: "Full widget list (replace_all)",
              items: {
                type: "object",
                properties: {
                  widget: widgetJsonSchema,
                  layout: layoutJsonSchema,
                },
                required: ["widget"],
              },
            },
          },
          required: ["op"],
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_view_delete",
    description: "Delete a saved view by UUID. If it was active, clears the live screen.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_view_carousel",
    description:
      "Enable/disable automatic cycling between saved views. Omit views (or pass []) to cycle all saved views; pass view ids to restrict the pool (order preserved). intervalSec default 10 (min 3). transition: fade | slide | scale. Call with enabled:false to stop. Panel must be open to advance.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true to start / update autoplay; false to stop" },
        views: {
          type: "array",
          items: { type: "string" },
          description: "Optional view ids to cycle (omit or [] = all saved views)",
        },
        intervalSec: {
          type: "integer",
          minimum: 3,
          description: "Seconds between switches (default 10, min 3)",
        },
        transition: {
          type: "string",
          enum: [...CAROUSEL_TRANSITIONS],
          description: "View transition animation (default fade)",
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_overlay_list",
    description: "List saved overlays (id, slug, title, mode, anchor, viewIds, updatedAt)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_overlay_get",
    description: "Read one saved overlay by UUID (chrome + definition + layout)",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Overlay UUID from ud_overlay_list" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_overlay_create",
    description:
      "Create an empty overlay (shared chrome across views). mode: float (superimposed) or dock (reserves space / pushes the view). anchor: top|bottom|left|right|corners|center|center-left|center-right (dock forbids bare center). views omit/[] = all views; pass view UUIDs to restrict. opacity 0–1. Does not change which view is loaded.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Unique slug e.g. news-ticker" },
        title: { type: "string" },
        mode: { type: "string", enum: [...OVERLAY_MODES], description: "float = over view; dock = push/reserve space" },
        anchor: { type: "string", enum: [...OVERLAY_ANCHORS] },
        width: {
          description: 'Optional width: px number or percentage string e.g. "100%"',
          oneOf: [{ type: "number", exclusiveMinimum: 0 }, { type: "string", pattern: "^\\d+(\\.\\d+)?%$" }],
        },
        height: {
          description: 'Optional height: px number or percentage string e.g. "12%"',
          oneOf: [{ type: "number", exclusiveMinimum: 0 }, { type: "string", pattern: "^\\d+(\\.\\d+)?%$" }],
        },
        opacity: { type: "number", minimum: 0, maximum: 1, description: "Default 1; useful for float watermarks" },
        order: { type: "integer", minimum: 0, description: "Stack order within same edge (default 0)" },
        views: {
          type: "array",
          items: { type: "string" },
          description: "View UUIDs this overlay applies to (omit or [] = all views)",
        },
      },
      required: ["slug", "mode", "anchor"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_overlay_patch",
    description:
      "Patch overlay by id: chrome (mode/anchor/size/opacity/order/views), optional slug/title/grid, and/or widgets op (same as ud_view_patch). Pass width/height null to clear. Write-through to live screen when the overlay matches the active view.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Overlay UUID" },
        slug: { type: "string" },
        title: { type: "string" },
        mode: { type: "string", enum: [...OVERLAY_MODES] },
        anchor: { type: "string", enum: [...OVERLAY_ANCHORS] },
        width: {
          description: 'px number, percentage string, or null to clear',
          oneOf: [
            { type: "number", exclusiveMinimum: 0 },
            { type: "string", pattern: "^\\d+(\\.\\d+)?%$" },
            { type: "null" },
          ],
        },
        height: {
          description: 'px number, percentage string, or null to clear',
          oneOf: [
            { type: "number", exclusiveMinimum: 0 },
            { type: "string", pattern: "^\\d+(\\.\\d+)?%$" },
            { type: "null" },
          ],
        },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        order: { type: "integer", minimum: 0 },
        views: {
          type: "array",
          items: { type: "string" },
          description: "Replace view association (omit to keep; [] = all views)",
        },
        grid: {
          type: "object",
          properties: {
            columns: { type: "integer", minimum: 1, maximum: MAX_COLUMNS },
            visible: { type: "boolean" },
          },
        },
        widgets: {
          type: "object",
          description: "One widget operation (same ops as ud_view_patch)",
          properties: {
            op: { type: "string", enum: ["upsert", "remove", "replace_all", "clear"] },
            widget: widgetJsonSchema,
            layout: layoutJsonSchema,
            id: { type: "string", description: "Widget id (remove)" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  widget: widgetJsonSchema,
                  layout: layoutJsonSchema,
                },
                required: ["widget"],
              },
            },
          },
          required: ["op"],
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_overlay_delete",
    description: "Delete a saved overlay by UUID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_screen_get",
    description: "Read the live panel (IR + layout + activeViewId + matching overlays). Inline/dataset data is summarized.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_screen_load",
    description: "Load a saved view onto the live panel by view UUID. Sets activeViewId; hydrates bound datasets from cache.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_screen_clear",
    description: "Clear the live panel and activeViewId (keeps grid config; does not delete saved views or datasets)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_widgets_spec",
    description:
      "Return full IR widget specs (JSON Schema for each type's props). Call this when unsure which props a widget accepts — do not read plugin source. Optional type filter e.g. Stat.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Optional widget type filter (e.g. Stat, Icon, HorizontalTiles)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ud_datasets_upsert",
    description:
      "Create/update a persisted dataset: HTTP GET, single parent (source.dataset), or multi-parent (source.datasets) + refreshIntervalSec + optional QuickJS transform. On update, omit source / refreshIntervalSec / transform to keep existing values (partial patch). Derived sources re-read parent cache(s); cycles rejected. Refreshing a parent cascades to dependents. Plugin refreshes automatically; agent does not poll.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Persisted slug e.g. orders-live (not _screen.*)" },
        source: {
          type: "object",
          description:
            "Required on create; omit on update to keep the current source. Exactly one of: { url, headers?, jsonPath? } HTTP GET; { dataset, jsonPath? } one parent; { datasets: [key,…] } two+ parents (transform gets { [key]: data }).",
          properties: {
            url: {
              type: "string",
              description: "HTTP(S) JSON URL (mutually exclusive with dataset / datasets)",
            },
            dataset: {
              type: "string",
              description:
                "Single parent key — transform receives that payload (mutually exclusive with url / datasets).",
            },
            datasets: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              description:
                "Two or more parent keys — transform receives { [parentKey]: data }. No jsonPath; slice in transform.",
            },
            headers: { type: "object", additionalProperties: { type: "string" } },
            jsonPath: {
              type: "string",
              description: "Optional dot path into HTTP body or single-parent payload (not with datasets)",
            },
          },
        },
        refreshIntervalSec: {
          type: "integer",
          minimum: 60,
          description: "Default 600 on create; omit on update to keep existing",
        },
        transform: {
          type: "string",
          description:
            'Optional QuickJS sync function body for (data) => … after resolve(+jsonPath). Multi-parent: data is { [key]: payload }. Must return JSON. No fetch/fs/async. Omit to keep existing; pass "" to clear.',
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_datasets_get",
    description: "Read one dataset (source + summarized cache + schedule/error)",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_datasets_list",
    description: "List persisted datasets (meta only)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_datasets_refresh",
    description:
      "Force-refresh one dataset now (after upsert). HTTP sources re-GET; derived sources re-read the parent cache. Cascades to dependents. Verify payload before binding widgets.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_datasets_delete",
    description: "Delete a persisted dataset",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
] as const;

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "ud_view_list":
        return text({ views: listViews() });
      case "ud_view_get": {
        const id = z.string().min(1).parse(args.id);
        const view = getView(id);
        if (!view) throw new Error(`View not found: ${id}`);
        return text(summarizeView(view));
      }
      case "ud_view_create": {
        const slug = z.string().min(1).parse(args.slug);
        const title = args.title !== undefined ? z.string().parse(args.title) : undefined;
        return text(summarizeView(createView({ slug, title })));
      }
      case "ud_view_patch": {
        const id = z.string().min(1).parse(args.id);
        const slug = args.slug !== undefined ? z.string().min(1).parse(args.slug) : undefined;
        const title = args.title !== undefined ? z.string().parse(args.title) : undefined;
        let grid: { columns?: number; visible?: boolean } | undefined;
        if (args.grid !== undefined) {
          const g = z
            .object({
              columns: z.number().int().min(1).max(MAX_COLUMNS).optional(),
              visible: z.boolean().optional(),
            })
            .parse(args.grid);
          grid = g;
        }
        let widgets: WidgetPatchOp | undefined;
        if (args.widgets !== undefined) {
          const parsed = widgetsOpSchema.parse(args.widgets);
          if (parsed.op === "upsert") {
            widgets = {
              op: "upsert",
              widget: parsed.widget as WidgetSpec,
              layout: parsed.layout,
            };
          } else if (parsed.op === "remove") {
            widgets = { op: "remove", id: parsed.id };
          } else if (parsed.op === "replace_all") {
            widgets = {
              op: "replace_all",
              items: parsed.items.map((it) => ({
                widget: it.widget as WidgetSpec,
                layout: it.layout,
              })),
            };
          } else {
            widgets = { op: "clear" };
          }
        }
        if (slug === undefined && title === undefined && grid === undefined && widgets === undefined) {
          throw new Error("ud_view_patch requires at least one of: slug, title, grid, widgets");
        }
        return text(summarizeView(patchView({ id, slug, title, grid, widgets })));
      }
      case "ud_view_delete": {
        const id = z.string().min(1).parse(args.id);
        return text(deleteView(id));
      }
      case "ud_view_carousel": {
        const enabled = z.boolean().parse(args.enabled);
        const intervalSec =
          args.intervalSec !== undefined ? z.number().int().min(3).parse(args.intervalSec) : undefined;
        const transition =
          args.transition !== undefined
            ? z.enum(["fade", "slide", "scale"]).parse(args.transition)
            : undefined;
        let views: string[] | null | undefined = undefined;
        if (args.views !== undefined) {
          views = z.array(z.string().min(1)).parse(args.views);
        }
        return text(
          setCarousel({
            enabled,
            views,
            intervalSec,
            transition: transition as "fade" | "slide" | "scale" | undefined,
          }),
        );
      }
      case "ud_overlay_list":
        return text({ overlays: listOverlays() });
      case "ud_overlay_get": {
        const id = z.string().min(1).parse(args.id);
        const overlay = getOverlay(id);
        if (!overlay) throw new Error(`Overlay not found: ${id}`);
        return text(summarizeOverlay(overlay));
      }
      case "ud_overlay_create": {
        const slug = z.string().min(1).parse(args.slug);
        const title = args.title !== undefined ? z.string().parse(args.title) : undefined;
        const mode = z.enum(OVERLAY_MODES).parse(args.mode) as OverlayMode;
        const anchor = z.enum(OVERLAY_ANCHORS).parse(args.anchor) as OverlayAnchor;
        const sizeSchema = z.union([
          z.number().positive(),
          z.string().regex(/^\d+(\.\d+)?%$/),
        ]);
        const width = args.width !== undefined ? (sizeSchema.parse(args.width) as OverlaySize) : undefined;
        const height = args.height !== undefined ? (sizeSchema.parse(args.height) as OverlaySize) : undefined;
        const opacity =
          args.opacity !== undefined ? z.number().min(0).max(1).parse(args.opacity) : undefined;
        const order = args.order !== undefined ? z.number().int().min(0).parse(args.order) : undefined;
        const views =
          args.views !== undefined ? z.array(z.string().min(1)).parse(args.views) : undefined;
        return text(
          summarizeOverlay(
            createOverlay({ slug, title, mode, anchor, width, height, opacity, order, views }),
          ),
        );
      }
      case "ud_overlay_patch": {
        const id = z.string().min(1).parse(args.id);
        const slug = args.slug !== undefined ? z.string().min(1).parse(args.slug) : undefined;
        const title = args.title !== undefined ? z.string().parse(args.title) : undefined;
        const mode =
          args.mode !== undefined ? (z.enum(OVERLAY_MODES).parse(args.mode) as OverlayMode) : undefined;
        const anchor =
          args.anchor !== undefined
            ? (z.enum(OVERLAY_ANCHORS).parse(args.anchor) as OverlayAnchor)
            : undefined;
        const sizeOrNull = z.union([
          z.number().positive(),
          z.string().regex(/^\d+(\.\d+)?%$/),
          z.null(),
        ]);
        const width =
          args.width !== undefined ? (sizeOrNull.parse(args.width) as OverlaySize | null) : undefined;
        const height =
          args.height !== undefined ? (sizeOrNull.parse(args.height) as OverlaySize | null) : undefined;
        const opacity =
          args.opacity !== undefined ? z.number().min(0).max(1).parse(args.opacity) : undefined;
        const order = args.order !== undefined ? z.number().int().min(0).parse(args.order) : undefined;
        const views =
          args.views !== undefined ? z.array(z.string().min(1)).parse(args.views) : undefined;
        let grid: { columns?: number; visible?: boolean } | undefined;
        if (args.grid !== undefined) {
          grid = z
            .object({
              columns: z.number().int().min(1).max(MAX_COLUMNS).optional(),
              visible: z.boolean().optional(),
            })
            .parse(args.grid);
        }
        let widgets: WidgetPatchOp | undefined;
        if (args.widgets !== undefined) {
          const parsed = widgetsOpSchema.parse(args.widgets);
          if (parsed.op === "upsert") {
            widgets = {
              op: "upsert",
              widget: parsed.widget as WidgetSpec,
              layout: parsed.layout,
            };
          } else if (parsed.op === "remove") {
            widgets = { op: "remove", id: parsed.id };
          } else if (parsed.op === "replace_all") {
            widgets = {
              op: "replace_all",
              items: parsed.items.map((it) => ({
                widget: it.widget as WidgetSpec,
                layout: it.layout,
              })),
            };
          } else {
            widgets = { op: "clear" };
          }
        }
        if (
          slug === undefined &&
          title === undefined &&
          mode === undefined &&
          anchor === undefined &&
          width === undefined &&
          height === undefined &&
          opacity === undefined &&
          order === undefined &&
          views === undefined &&
          grid === undefined &&
          widgets === undefined
        ) {
          throw new Error(
            "ud_overlay_patch requires at least one of: slug, title, mode, anchor, width, height, opacity, order, views, grid, widgets",
          );
        }
        return text(
          summarizeOverlay(
            patchOverlay({
              id,
              slug,
              title,
              mode,
              anchor,
              width,
              height,
              opacity,
              order,
              views,
              grid,
              widgets,
            }),
          ),
        );
      }
      case "ud_overlay_delete": {
        const id = z.string().min(1).parse(args.id);
        return text(deleteOverlay(id));
      }
      case "ud_screen_get":
        return text(summarizeScreen(getScreen()));
      case "ud_screen_load": {
        const id = z.string().min(1).parse(args.id);
        return text(summarizeScreen(loadViewOnScreen(id)));
      }
      case "ud_screen_clear":
        return text(summarizeScreen(clearScreen()));
      case "ud_widgets_spec": {
        const type = args.type !== undefined ? z.string().min(1).parse(args.type) : undefined;
        return text(widgetsSpec(type));
      }
      case "ud_datasets_upsert": {
        const key = z.string().min(1).parse(args.key);
        const refreshIntervalSec =
          args.refreshIntervalSec !== undefined ? z.number().int().min(60).parse(args.refreshIntervalSec) : undefined;
        let transform: string | null | undefined = undefined;
        if (args.transform === null) transform = null;
        else if (typeof args.transform === "string") {
          transform = args.transform.trim() === "" ? null : args.transform;
        }
        const rec = upsertDataset({ key, source: args.source, refreshIntervalSec, transform });
        return text(summarizeDataset(rec));
      }
      case "ud_datasets_get": {
        const key = z.string().min(1).parse(args.key);
        const rec = getDataset(key);
        if (!rec) throw new Error(`Dataset not found: ${key}`);
        return text(summarizeDataset(rec));
      }
      case "ud_datasets_list":
        return text({ datasets: listDatasets() });
      case "ud_datasets_refresh": {
        const key = z.string().min(1).parse(args.key);
        const rec = await refreshDataset(key);
        return text(summarizeDataset(rec));
      }
      case "ud_datasets_delete": {
        const key = z.string().min(1).parse(args.key);
        return text(deleteDataset(key));
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return fail(err);
  }
}

function send(msg: unknown) {
  const body = JSON.stringify(msg);
  if (useContentLength) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  } else {
    process.stdout.write(body + "\n");
  }
}

function reply(id: JsonRpcId, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: JsonRpcId, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function serveMcp() {
  process.stdin.setEncoding("utf8");
  let buffer = "";

  const handle = async (msg: {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: Record<string, unknown>;
  }) => {
    const id = msg.id ?? null;
    const method = msg.method || "";

    if (method === "initialize") {
      reply(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "universal-dashboard", version: "0.1.0" },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") return;
    if (method === "ping") {
      reply(id, {});
      return;
    }
    if (method === "tools/list") {
      reply(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      return;
    }
    if (method === "tools/call") {
      const name = String(msg.params?.name || "");
      const args = (msg.params?.arguments || {}) as Record<string, unknown>;
      const result = await callTool(name, args);
      reply(id, result);
      return;
    }
    if (id !== null && id !== undefined) {
      replyError(id, -32601, `Method not found: ${method}`);
    }
  };

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      if (buffer.startsWith("Content-Length:")) {
        useContentLength = true;
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buffer.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const len = parseInt(match[1]!, 10);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + len) break;
        const body = buffer.slice(bodyStart, bodyStart + len);
        buffer = buffer.slice(bodyStart + len);
        try {
          void handle(JSON.parse(body));
        } catch (err) {
          process.stderr.write(String(err) + "\n");
        }
        continue;
      }

      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        void handle(JSON.parse(line));
      } catch (err) {
        process.stderr.write(String(err) + "\n");
      }
    }
  });
}
