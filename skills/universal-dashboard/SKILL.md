---
name: universal-dashboard
description: Agent Omarchy dashboard via MCP (IR + views + auto-refresh datasets).
---

# Universal Dashboard

**Universal Dashboard is the agent's screen on Omarchy.** When the user refers to "the dashboard", "the screen", or asks to show / display something, they mean this panel. You control it via MCP tools prefixed with **`ud_`**.

The Quickshell panel is a passive renderer: it watches `~/.local/state/universal-dashboard/` and redraws when state changes. **The plugin** refreshes datasets on a schedule (not you in a loop).

This skill ships with the Omarchy plugin (`skills/universal-dashboard/`). Keep it in sync by updating the plugin (or following a symlink to the checkout) — there is no MCP tool to refresh it.

Follow the **user's topic**. Do not invent a domain, sample API, or demo dashboard unless they asked for one.

## Hard rule: MCP only — stop on gaps

You control the dashboard **only** through the **`ud_*` MCP tools** (and this skill). That is the full product surface for agents.

**Capability discovery (in order):**

1. This skill (workflows + forbidden patterns)
2. MCP `tools/list` inputSchemas (tool args)
3. **`ud_widgets_spec`** `{ "type": "<Widget>" }` when a widget prop is in doubt — then use **only** props that schema lists

Do **not** read plugin / repo source (`qml/`, `mcp/`, `packages/ir`, …). Do **not** invent undocumented props or widget types.

### Gap → stop (no workaround)

**If** the request needs a missing tool, widget, or prop (e.g. `Stat` has no size for the change line):

1. Call `ud_widgets_spec` on the relevant type if you have not already (confirm the gap)
2. **Stop immediately** — do not execute a partial redesign
3. Tell the user, in plain language: what was asked, what the schema allows, what is missing

**Do not:**

- Suggest or apply a workaround (other widget, `Text` instead of `Stat` styling, extra `transform` fields, CLI, editing the plugin)
- Ask “je continue ?” after choosing a workaround yourself
- Patch or propose code changes to the plugin / skill / IR unless the user explicitly asks to extend the product

Workarounds are allowed **only** when the user explicitly requests that specific alternative after you reported the gap.

### Forbidden

- Reading or modifying Universal Dashboard / Omarchy plugin source to implement dashboard features
- Contourner un trou de schéma (prop absente) avec un autre widget ou un champ dérivé
- Mutating the live screen for content — always `ud_view_patch` / `ud_overlay_patch` (then `ud_screen_load` if the view is not active)
- Using `widgets.op: "replace_all"` / `"clear"` when you only meant to update one widget — use `upsert` / `remove`
- `Stat` / `Table` / `Icon` with `dataset` **without** a prior successful upsert (+ refresh)
- Dumping live numbers into a giant `Markdown` blob
- Using `Table` for hour→icon / forecast strips — use `HorizontalTiles` instead
- Using `_screen.*` / `widget.data` for anything that must survive reload or auto-refresh
- Putting `layout` / `children` inside `props`
- Expecting the view IR to map codes → icons (use `transform` instead)
- Icon glyphs that are English/icon-pack names instead of characters
- Steering the user toward an unrelated sample topic

## Mental model

| Layer | What it is | Who |
|---|---|---|
| **View** | Persisted dashboard (IR + layout), addressed by **UUID** | You via `ud_view_*` |
| **Overlay** | Shared chrome across views (`float` or `dock`), addressed by **UUID** | You via `ud_overlay_*` |
| **Screen** | Live panel now (`activeViewId` + IR + matching overlays) | You via `ud_screen_get` / `load` / `clear` |
| **Dataset** | Named JSON **cache** + last fetch / error | Plugin files under `datasets/` |
| **Source** | HTTP GET **or** parent `dataset` / `datasets` (+ optional `jsonPath` on single) + optional **QuickJS `transform`** + `refreshIntervalSec` | You **once** at create; plugin **runs** forever after |

**Live / recurring data** = dataset with source (+ transform when you need derived fields) + interval, then widgets bound to that key.

**Derived dataset** — no extra HTTP; parents must exist; **cycles rejected**; refreshing a parent **cascades** to dependents:

- Single: `source: { dataset: "<parent>", jsonPath? }` — transform receives that payload
- Multi: `source: { datasets: ["a", "b", …] }` — transform receives `{ a: …, b: … }` (no top-level `jsonPath`; slice in transform)

**One-shot / demo** only: `widget.data` → ephemeral `_screen.<id>` (no refresh, lost on view reload).

| Id | From | Use with |
|---|---|---|
| **Node id** | Widget `id` (unique within a view **or** overlay) | `ud_view_patch` / `ud_overlay_patch` widgets upsert/remove |
| **View UUID** | `ud_view_list` / `ud_view_create` | `ud_view_get` / `patch` / `delete`, `ud_screen_load`, overlay `views[]` |
| **Overlay UUID** | `ud_overlay_list` / `ud_overlay_create` | `ud_overlay_get` / `patch` / `delete` |
| **Dataset key** | `ud_datasets_upsert` slug (e.g. `orders-live`) | `props.dataset` on Stat/Table/Icon/Text/Title/Badge/… |

## Live dashboard workflow (required)

When the user wants data that **stays correct over time**:

1. `ud_view_create` `{ slug, title? }` → keep the returned `id` (does **not** change the live panel)
2. `ud_datasets_upsert` `{ key, source?: { url, jsonPath? } | { dataset, jsonPath? } | { datasets: [..] }, refreshIntervalSec?, transform? }` — **`source` required on create**; on update, omit `source` / `refreshIntervalSec` / `transform` to keep existing (e.g. change transform only)
3. `ud_datasets_refresh` `{ key }` — check summarized payload (incl. fields added by transform); parent refresh also refreshes dependents
4. `ud_view_patch` `{ id, widgets: { op: "upsert", widget: { … props.dataset… }, layout? } }` (repeat per widget)
5. `ud_screen_load` `{ id }` so the panel shows it
6. **Do not** poll or re-fetch yourself — the panel runs `refresh-due` on open and every ~30s

Derive `key` / `slug` / labels from the user's request — not from canned demos.

### QuickJS `transform` (optional)

Function **body** only — sync `(data) => …` — run in a WASM sandbox after resolve + `jsonPath` (single parent / HTTP):

- Must **`return`** a JSON-serializable value (becomes `dataset.data`)
- **No** `fetch`, FS, modules, `async`, or host APIs
- Limits: ~1s CPU, ~8 MiB memory
- Use to reshape API JSON or parent payload(s) for widgets — **not** conditions inside the IR
- Prefer **derived** datasets (`source.dataset` / `source.datasets`) instead of re-fetching the same URL
- Multi-parent example: `return { total: data.orders.length + data.returns.length }` when `datasets: ["orders","returns"]`
- **`Icon.glyph` / `glyphField` must be a real character** (emoji or Nerd Font codepoint). Never invent slug names like `"ok"` / `"warn-icon"` as the glyph — those render as literal text.

## Views vs screen

- **View** = saved dashboard. Always pass **`id`** to `ud_view_get` / `patch` / `delete`. Mutate content only with **`ud_view_patch`**.
- **Screen** = what the panel shows now. `ud_screen_get` (includes `activeViewId` + matching `overlays`), `ud_screen_load` `{ id }`, `ud_screen_clear`.
- Patching the **active** view write-throughs to the live screen. Patching another view does not change the panel until `ud_screen_load`.

## Overlays (shared chrome)

Overlays stay visible while the carousel / ←→ switches views (only the view body animates).

| `mode` | Behavior | Use for |
|---|---|---|
| **`dock`** | Reserves space; **pushes** the view (does not cover it) | News ticker, status bandeau, side rail |
| **`float`** | Superimposed on top of the shell | Semi-transparent logo, watermark, corner badge |

| Field | Notes |
|---|---|
| `anchor` | `top` / `bottom` / `left` / `right` / corners / `center` / `center-left` / `center-right`. **`dock` forbids bare `center`**. |
| `width` / `height` | Optional px number or `"40%"` / `"100%"`. Omit → content-sized. Dock top/bottom often `height`; left/right often `width`. |
| `opacity` | 0–1 (default 1). Mainly for `float`. |
| `order` | Stack order within the same dock edge / float layer (lower first). |
| `views` | Omit or `[]` = **all views**. Pass view UUIDs to restrict. |

Workflow: `ud_overlay_create` → `ud_overlay_patch` widgets (same ops as views) → overlays matching the active view appear on the panel automatically (no separate “load”).

### `ud_view_patch` widgets ops

| `op` | Required | Effect |
|---|---|---|
| `upsert` | `widget` (+ optional `layout`) | Create or replace that widget **id** (full subtree); attach under the view root |
| `remove` | `id` (widget id) | Delete that widget subtree |
| `replace_all` | `items: [{ widget, layout? }, …]` | Exact new top-level widget list |
| `clear` | — | Remove all widgets (empty view) |

Also optional on the same call: `slug`, `title`, `grid: { columns?, visible? }`.

`layout.column` is **1-based**. Do not put placement inside `props`.

| Intent | Do |
|---|---|
| Create new dashboard | `ud_view_create` → datasets → `ud_view_patch` widgets → `ud_screen_load` |
| Add / update one widget | `ud_view_patch` `{ id, widgets: { op: "upsert", widget, layout? } }` |
| Remove one widget | `ud_view_patch` `{ id, widgets: { op: "remove", id: "<widget-id>" } }` |
| Rebuild all widgets | `ud_view_patch` `{ id, widgets: { op: "replace_all", items: […] } }` |
| Rename view | `ud_view_patch` `{ id, slug?, title? }` |
| Wider grid | `ud_view_patch` `{ id, grid: { columns: N } }` |
| Show a view | `ud_view_list` → `ud_screen_load` `{ id }` |
| Inspect live / active | `ud_screen_get` |
| Clear panel only | `ud_screen_clear` (views kept) |
| Auto-cycle | `ud_view_carousel` `{ enabled: true, intervalSec?, views?: [id…], transition? }` |
| Shared chrome (all views) | `ud_overlay_create` `{ slug, mode, anchor, … }` → `ud_overlay_patch` widgets |
| Shared chrome (subset) | `ud_overlay_create` / `patch` with `views: [viewUuid, …]` |
| Delete overlay | `ud_overlay_delete` — only if user asks |
| Delete view | `ud_view_delete` — only if user asks |
| Delete dataset | `ud_datasets_delete` — only if user asks |

## Composition & props

- One `ud_view_patch` widgets upsert = one top-level widget (nested `children` allowed for templates).
- Style/prop tweaks: same widget `id` + `op: "upsert"` — never `replace_all` / `clear` for that.
- Size tokens (text): `xs` | `sm` | `md` | `lg` | `xl` | `2xl`
- **Icon** sizes (dedicated px, same trick as Omarchy weather: raw `pixelSize`, not `Style.font`): `xs`…`6xl` | `hero`
  - `2xl` / `hero` = **64px** (native weather panel hero)
  - `3xl`…`6xl` = 80 / 96 / 128 / 160 — use these next to large Stats
- **Placement** (`widgets.layout` on patch, not inside `props`):
  - `column` — **1-based** start column (`1` … `grid.columns`). Never `0`.
  - `index` — **0-based row** (same value = same horizontal band across columns). Not “add order”.
  - `colspan` — width in columns (default `1`; full-width hero uses all columns).
  - Omit `column` → horizontal-first auto-flow (fills left→right, then wraps).
- Default grid: **3 columns**. Widen with `ud_view_patch` `{ grid: { columns: N } }` (1–26). This is **not** the IR `Grid` widget (`props.cols`).
- Side-by-side on one row: **same `index`**, consecutive `column`s (e.g. icon `column:1,index:1` + stat `column:2,index:1`).

## Widgets (MVP)

Rendered: `Stack`, `Group`, `Grid`, `Container`, `Panel`, `Card`, `ScrollArea`, `Title`, `Text`, `Marquee`, `Markdown`, `Icon`, `Badge`, `Stat`, `Divider`, `Table`, `HorizontalTiles`, `List`, `Timeline`, `Image`, `Button`, `Anchor`, `Chart`, `Video`, `Youtube`.

Placeholder: `Map`. (`Chart` kinds `heatmap` / `treemap` / `radar` are stubs. Button `openDetail` and List `detailKey` are not implemented.)

`Markdown` = short prose / notes only — **not** for live metrics.

`Text` / `Title` / `Badge` = static `text` **or** live `textField` + optional `dataset` (first row / object). Inside `HorizontalTiles`, omit `dataset` on children — the stamped row supplies fields.

`Marquee` = horizontal scrolling ticker. Props: `text` / `textField` (+ optional `dataset`, `separator` to join all rows), `speed` (px/s, default 40), `direction` (`left`|`right`), `gap`, `pauseOnHover` (default true), `onlyIfOverflow`, plus usual text style (`size`, `color`, `weight`, `italic`). Call `ud_widgets_spec` `{ "type": "Marquee" }` for the schema.

`Video` = inline media via Qt Multimedia. Props: `src` or `srcField` (+ optional `dataset`), `height` (px) or `size` (`xs`…`2xl`, default `md` → 240px), optional `aspect: "16:9"` (height tracks width when `height` omitted), `fit` (`cover` default = crop to fill; `contain` letterboxes; `stretch`), `autoPlay` (default true), `sound` (default false = muted), `controls` (default true — hover bar with play/pause + mute). Host needs `qt6-multimedia` (FFmpeg backend). HLS (`.m3u8`) may work depending on the stream. Call `ud_widgets_spec` `{ "type": "Video" }` for the schema.

`Youtube` = YouTube watch URL / video id → direct stream via **yt-dlp** (signed URLs refreshed on a timer; also on playback error). **Not** a WebEngine iframe (Quickshell cannot embed Chromium reliably). Props: `src` and/or `videoId` (or `srcField` / `videoIdField` + `dataset`), same `height` / `size` / `aspect` / `fit` / `autoPlay` / `sound` / `controls` as `Video`, optional `resolveIntervalSec` (default 1200, min 300). Host needs `yt-dlp` on `PATH` + `qt6-multimedia`. Prefer `Youtube` for youtube.com / youtu.be; use `Video` for direct file/HLS URLs. Call `ud_widgets_spec` `{ "type": "Youtube" }` for the schema.

`Image` = remote/local image. Props: `src` or `srcField` (+ optional `dataset`), `alt` / `altField`, `height` (px, default 160), `radius` (size token).

`Anchor` = clickable http(s) link. Props: `label` / `labelField`, `href` / `hrefField`, optional `dataset`, `size`. Opens with the system browser.

`List` = card grid/stack from a dataset. Props: `dataset`, `titleField`, optional `subtitleField` / `metaField` / `imageField` / `hrefField`, `layout` (`stack`|`grid`), `cols`, `limit`, optional `size` (`xs`…`2xl`, default `md` — title uses that token; subtitle/meta step down). When `hrefField` resolves to http(s), the **whole card** is clickable (title stays normal text, no underline). Do **not** rely on `detailKey` (unsupported).

`Timeline` = vertical event list. Props: `dataset`, `titleField`, `timeField`, optional `bodyField`.

`Button` = labeled control with `on.click`. Supported actions: `openUrl` `{ url }`, `navigate` `{ viewId }`, `dataset.refresh` `{ dataset }`. **`openDetail` is not supported** — stop if the user needs it.

`Table` = numeric/text columns (`columns: [{ label, field, hrefField? }, …]`). Optional table `size` (`xs`…`2xl`, default `md`). When a column sets `hrefField`, that cell opens the row’s http(s) URL (label still from `field`). **Not** for hour→icon strips.

`HorizontalTiles` = stamp `children[]` once per dataset row into a horizontal band/grid. Prefer for forecasts / chip rows / hourly glyphs (`cols`, `limit`; default `layout: "grid"`). Template fields (`glyphField` / `textField` / `field`) bind to **each row** (no per-child `dataset` needed). (`Repeat` is a legacy alias.)

`Chart` = dataset rows plotted with `props: { kind, dataset, x, y: [field…], height? }`. Drawn kinds: `line`, `area`, `bar`, `barStacked`, `scatter`, `pie`, `donut`, `gauge`. Call `ud_widgets_spec` `{ "type": "Chart" }` for the full schema.

### Patterns (domain-agnostic)

**Live bind** — after `ud_view_create` + dataset upsert/refresh (`id` = view UUID):

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "metric-a",
      "type": "Stat",
      "props": { "label": "…", "dataset": "<key>", "field": "<field>" }
    },
    "layout": { "column": 1, "index": 0 }
  }
}
```

**Live text line** (no Stat chrome) — `Text` / `Title` / `Badge` with `dataset` + `textField`:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "updated-at",
      "type": "Text",
      "props": { "dataset": "<key>", "textField": "time", "size": "sm", "color": "muted" }
    },
    "layout": { "column": 1, "index": 2 }
  }
}
```

**Marquee ticker** — static or live (`textField` + `dataset`; multi-row values joined with `separator`):

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "headlines",
      "type": "Marquee",
      "props": {
        "dataset": "<key>",
        "textField": "title",
        "separator": "  ·  ",
        "speed": 50,
        "size": "md",
        "color": "muted"
      }
    },
    "layout": { "column": 1, "colspan": 3, "index": 0 }
  }
}
```

**Dock overlay bandeau** (pushes the view; survives carousel) — after views exist:

```json
{
  "slug": "news-banner",
  "mode": "dock",
  "anchor": "top",
  "height": 48,
  "views": ["<view-uuid-a>", "<view-uuid-b>"]
}
```

Then `ud_overlay_patch` widgets upsert a `Marquee` (same widget shape as views; `id` = overlay UUID).

**Float watermark** — `mode: "float"`, `anchor: "bottom-right"`, `opacity: 0.35`, optional `width`/`height`.

**Video** — URL (file / http / often HLS `.m3u8`); muted autoplay by default:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "cam",
      "type": "Video",
      "props": {
        "src": "https://example.com/stream.m3u8",
        "size": "lg",
        "autoPlay": true,
        "sound": false
      }
    },
    "layout": { "column": 1, "colspan": 3, "index": 0 }
  }
}
```

**Youtube** — watch URL or video id (needs `yt-dlp`); muted autoplay; stream re-resolved every ~20 min:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "yt-bloomberg",
      "type": "Youtube",
      "props": {
        "src": "https://www.youtube.com/watch?v=QB5BNdBFujE",
        "size": "lg",
        "autoPlay": true,
        "sound": false
      }
    },
    "layout": { "column": 1, "colspan": 2, "index": 0 }
  }
}
```

**Icon from data** — `props`: `{ "dataset": "<key>", "glyphField": "<field>", "size": "hero" }` (or `3xl`…`6xl`) where that field holds a single glyph character. Prefer `hero`/`2xl`+ next to Stats — not `md`.

**Hourly / forecast strip (`HorizontalTiles`)** — array dataset of `{ h, glyph, … }`:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "hours",
      "type": "HorizontalTiles",
      "props": { "dataset": "<key>", "layout": "grid", "cols": 6, "gap": "md", "limit": 12 },
      "children": [
        {
          "id": "hours-cell",
          "type": "Stack",
          "props": { "gap": "xs" },
          "children": [
            { "id": "hours-icon", "type": "Icon", "props": { "glyphField": "glyph", "size": "xl", "align": "center" } },
            { "id": "hours-h", "type": "Text", "props": { "textField": "h", "size": "sm", "align": "center", "color": "muted" } }
          ]
        }
      ]
    },
    "layout": { "column": 1, "colspan": 3, "index": 2 }
  }
}
```

**Table** — dense numbers / text (not icon strips). Optional `size`; optional per-column `hrefField` for clickable cells:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "rows",
      "type": "Table",
      "props": {
        "dataset": "<key>",
        "size": "sm",
        "columns": [
          { "label": "Title", "field": "title", "hrefField": "url" },
          { "label": "…", "field": "<b>" }
        ]
      }
    },
    "layout": { "column": 1, "colspan": 3, "index": 2 }
  }
}
```

**List** — small clickable cards (prefer over Table when the user wants a card layout):

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "stories",
      "type": "List",
      "props": {
        "dataset": "<key>",
        "layout": "grid",
        "cols": 2,
        "limit": 20,
        "size": "lg",
        "titleField": "title",
        "subtitleField": "score",
        "metaField": "domain",
        "hrefField": "url"
      }
    },
    "layout": { "column": 1, "colspan": 3, "index": 1 }
  }
}
```

**Button** — `on.click` (not inside `props`):

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "refresh-btn",
      "type": "Button",
      "props": { "label": "Refresh", "variant": "filled" },
      "on": { "click": { "action": "dataset.refresh", "dataset": "<key>" } }
    },
    "layout": { "column": 1, "index": 0 }
  }
}
```

**Chart** — array dataset; `x` = category field, `y` = one or more numeric fields:

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "trend",
      "type": "Chart",
      "props": {
        "kind": "line",
        "dataset": "<key>",
        "x": "t",
        "y": ["value"],
        "height": 280
      }
    },
    "layout": { "column": 1, "colspan": 3, "index": 3 }
  }
}
```

**One-shot** (no refresh):

```json
{
  "id": "<view-uuid>",
  "widgets": {
    "op": "upsert",
    "widget": {
      "id": "note",
      "type": "Stat",
      "props": { "label": "…", "field": "value" },
      "data": { "value": 0 }
    }
  }
}
```

**Dataset upsert shape** (fill URL/fields from the user's need):

```json
{
  "key": "<key>",
  "source": { "url": "<https://…>", "jsonPath": "<optional.dot.path>" },
  "refreshIntervalSec": 600,
  "transform": "return data;"
}
```

`transform` may enrich `data` (e.g. add a `glyph` character from a status code) then `return` the object/array widgets will bind.

## User panel shortcuts

Bar **UD** icon toggles the FloatingWindow.

| Key | Action |
|---|---|
| `←` / `→` or `n` / `p` | Cycle saved views |
| `c` | Toggle auto-cycle (carousel) |
| `Shift+C` | Cycle transition animation (fade → slide → scale) |
| `+` / `-` | Adjust carousel delay (only while auto-cycle is on; toast shows current seconds) |
| `V` | View list (↑↓ + Enter) |
| `d` | Delete current / listed view — press `d` again to confirm, `Esc` to cancel |
| `Esc` | Cancel delete confirm / close list / close window |
