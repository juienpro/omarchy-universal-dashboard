import { z } from "zod";
import {
  COMPONENT_TYPES,
  clearScreen,
  configureScreenGrid,
  deleteDataset,
  deleteView,
  getCarousel,
  getDataset,
  getScreen,
  getView,
  listDatasets,
  listViews,
  loadViewOnScreen,
  refreshDataset,
  refreshDueDatasets,
  saveScreenAsView,
  setCarousel,
  showOnScreen,
  summarizeDataset,
  summarizeScreen,
  upsertDataset,
  CAROUSEL_TRANSITIONS,
  type WidgetSpec,
} from "./store.js";
import { MAX_COLUMNS, widgetsSpec } from "@eow/ir";

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
    children: z.array(widgetSpecSchema).optional(),
  }),
);

const tools = [
  {
    name: "ud_screen_get",
    description: "Read live dashboard (IR + grid + placements). Inline/dataset data is summarized.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_screen_clear",
    description: "Clear the live dashboard (keeps grid config; does not delete datasets)",
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
    name: "ud_screen_show",
    description:
      "Show a widget on the live dashboard. Placement (top-level): column 1-based (1..grid.columns), index 0-based row, colspan. Omit column for horizontal-first auto-flow. Default grid is 3 columns (ud_screen_grid to change). For live data: bind props.dataset to a key from ud_datasets_upsert (no widget.data). HorizontalTiles: pass widget.children[] as the per-row template (Icon/Text/Stat/Stack…). Creating a dashboard: pass top-level view:{slug,title?} (sibling of widget).",
    inputSchema: {
      type: "object",
      properties: {
        widget: {
          type: "object",
          description: "Widget tree. Nested children allowed (HorizontalTiles template).",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: [...COMPONENT_TYPES] },
            props: { type: "object" },
            data: {},
            children: {
              type: "array",
              description: "Nested widgets (required for HorizontalTiles — stamped once per dataset row)",
              items: { type: "object" },
            },
          },
          required: ["id", "type"],
        },
        replace: { type: "boolean" },
        column: {
          type: "integer",
          minimum: 1,
          maximum: MAX_COLUMNS,
          description: "1-based start column (not 0-based)",
        },
        index: { type: "integer", minimum: 0, description: "0-based row (same index = same band across columns; not add-order)" },
        colspan: { type: "integer", minimum: 1, maximum: MAX_COLUMNS },
        view: {
          type: "object",
          description:
            "Top-level only (sibling of widget). Save/upsert after show. Required when creating a new dashboard. Never put inside widget or props.",
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
          },
          required: ["slug"],
        },
      },
      required: ["widget"],
    },
  },
  {
    name: "ud_screen_grid",
    description:
      "Configure the placement grid (default 3 columns). Raise columns (1–26) for wider dashboards. visible:true shows column number overlay labels.",
    inputSchema: {
      type: "object",
      properties: {
        columns: { type: "integer", minimum: 1, maximum: MAX_COLUMNS },
        visible: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ud_screen_save_view",
    description: "Save/overwrite the live dashboard as a named view (upsert by slug). Prefer view: on ud_screen_show when creating.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_screen_load_view",
    description: "Load a saved view onto the live dashboard by view id (hydrates bound datasets from cache)",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_views_list",
    description: "List saved views",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ud_views_delete",
    description: "Delete a saved view by id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ud_views_carousel",
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
    name: "ud_datasets_upsert",
    description:
      "Create/update a persisted dataset: HTTP GET JSON source + refreshIntervalSec + optional QuickJS transform body. Plugin refreshes automatically; agent does not poll.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Persisted slug e.g. orders-live (not _screen.*)" },
        source: {
          type: "object",
          properties: {
            url: { type: "string" },
            headers: { type: "object", additionalProperties: { type: "string" } },
            jsonPath: { type: "string", description: "Optional dot path into JSON body" },
          },
          required: ["url"],
        },
        refreshIntervalSec: { type: "integer", minimum: 60, description: "Default 600" },
        transform: {
          type: "string",
          description:
            "Optional QuickJS sync function body for (data) => … after GET+jsonPath. Must return JSON. No fetch/fs/async. Omit to keep existing; pass \"\" to clear.",
        },
      },
      required: ["key", "source"],
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
    description: "Force-fetch one dataset now (after upsert). Verify payload before binding widgets.",
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

function autoPersistView(view?: { slug?: string; title?: string } | null) {
  if (view?.slug) {
    return saveScreenAsView({ slug: String(view.slug), title: view.title !== undefined ? String(view.title) : undefined });
  }
  const state = getScreen();
  if (!state.activeViewId) return null;
  const existing = getView(state.activeViewId);
  if (!existing) return null;
  return saveScreenAsView({ slug: existing.slug, title: existing.title });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "ud_screen_get":
        return text(summarizeScreen(getScreen()));
      case "ud_screen_clear":
        return text(summarizeScreen(clearScreen()));
      case "ud_widgets_spec": {
        const type = args.type !== undefined ? z.string().min(1).parse(args.type) : undefined;
        return text(widgetsSpec(type));
      }
      case "ud_screen_grid": {
        const columns =
          args.columns !== undefined ? z.number().int().min(1).max(MAX_COLUMNS).parse(args.columns) : undefined;
        const visible = args.visible !== undefined ? z.boolean().parse(args.visible) : undefined;
        return text(summarizeScreen(configureScreenGrid({ columns, visible })));
      }
      case "ud_screen_show": {
        const widget = widgetSpecSchema.parse(args.widget) as WidgetSpec;
        showOnScreen({
          widget,
          replace: args.replace !== false,
          column: typeof args.column === "number" ? args.column : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
          colspan: typeof args.colspan === "number" ? args.colspan : undefined,
        });
        const viewArg =
          args.view && typeof args.view === "object" ? (args.view as { slug?: string; title?: string }) : null;
        const saved = autoPersistView(viewArg);
        const summary = summarizeScreen(getScreen());
        return text(saved ? { ...summary, savedView: { id: saved.id, slug: saved.slug, title: saved.title } } : summary);
      }
      case "ud_screen_save_view": {
        const slug = z.string().min(1).parse(args.slug);
        const title = args.title !== undefined ? z.string().parse(args.title) : undefined;
        const saved = saveScreenAsView({ slug, title });
        return text({ id: saved.id, slug: saved.slug, title: saved.title, updatedAt: saved.updatedAt });
      }
      case "ud_screen_load_view": {
        const id = z.string().min(1).parse(args.id);
        return text(summarizeScreen(loadViewOnScreen(id)));
      }
      case "ud_views_list":
        return text({ views: listViews() });
      case "ud_views_delete": {
        const id = z.string().min(1).parse(args.id);
        return text(deleteView(id));
      }
      case "ud_views_carousel": {
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
