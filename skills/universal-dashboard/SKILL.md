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
- `Stat` / `Table` / `Icon` with `dataset` **without** a prior successful upsert (+ refresh)
- Dumping live numbers into a giant `Markdown` blob
- Using `Table` for hour→icon / forecast strips — use `HorizontalTiles` instead
- Using `_screen.*` / `widget.data` for anything that must survive reload or auto-refresh
- Putting `view` inside `widget` / `props`
- Putting `children` / `layout` in `props`
- Expecting the view IR to map codes → icons (use `transform` instead)
- Icon glyphs that are English/icon-pack names instead of characters
- Steering the user toward an unrelated sample topic

## Mental model (three layers)

| Layer | What it is | Who |
|---|---|---|
| **View** | IR + layout (widgets on screen) | You via `ud_screen_show` / views |
| **Dataset** | Named JSON **cache** + last fetch / error | Plugin files under `datasets/` |
| **Source** | HTTP GET (+ optional `jsonPath`) + optional **QuickJS `transform`** + `refreshIntervalSec` | You **once** at create; plugin **runs** forever after |

**Live / recurring data** = dataset with source (+ transform when you need derived fields) + interval, then widgets bound to that key.

**One-shot / demo** only: `widget.data` → ephemeral `_screen.<id>` (no refresh, lost on view reload).

| Id | From | Use with |
|---|---|---|
| **Node id** | Widget `id` / `definition.nodes` | Live screen |
| **View UUID** | `ud_views_list` / `savedView.id` | `ud_screen_load_view`, `ud_views_delete` |
| **Dataset key** | `ud_datasets_upsert` slug (e.g. `orders-live`) | `props.dataset` on Stat/Table/Icon/… |

## Live dashboard workflow (required)

When the user wants data that **stays correct over time**:

1. `ud_datasets_upsert` `{ key, source: { url, jsonPath? }, refreshIntervalSec, transform? }`
2. `ud_datasets_refresh` `{ key }` — check summarized payload (incl. fields added by transform)
3. `ud_screen_show` widgets with `props.dataset: key` + `field` / `glyphField` (and `view: { slug, title }` on create)
4. **Do not** poll or re-fetch yourself — the panel runs `refresh-due` on open and every ~30s

Derive `key` / `slug` / labels from the user's request — not from canned demos.

### QuickJS `transform` (optional)

Function **body** only — sync `(data) => …` — run in a WASM sandbox after GET + `jsonPath`:

- Must **`return`** a JSON-serializable value (becomes `dataset.data`)
- **No** `fetch`, FS, modules, `async`, or host APIs
- Limits: ~1s CPU, ~8 MiB memory
- Use to reshape API JSON for widgets (derived fields, row lists, display strings) — **not** conditions inside the IR
- **`Icon.glyph` / `glyphField` must be a real character** (emoji or Nerd Font codepoint). Never invent slug names like `"ok"` / `"warn-icon"` as the glyph — those render as literal text.

## Views

Pass **top-level** `view: { slug, title? }` on `ud_screen_show` (sibling of `widget`) when creating a dashboard. Further shows re-save the active view. Views store IR + layout; **dataset payloads live in the dataset store** and are re-hydrated on load.

| Intent | Do |
|---|---|
| Create live dashboard | upsert dataset (+ transform) → refresh → show widgets + `view:` |
| Add widget | `ud_screen_show` `replace: false` |
| Wider grid | `ud_screen_grid` `{ "columns": N }` then place with `column` / `colspan` |
| Clear screen | `ud_screen_clear` (datasets remain) |
| Load | `ud_views_list` → `ud_screen_load_view` |
| Auto-cycle views | `ud_views_carousel` `{ enabled: true, intervalSec?, views?: [id…], transition?: "fade"|"slide"|"scale" }` — omit `views` (or `[]`) for all saved views; `{ enabled: false }` to stop. Panel must be open. |
| Delete view | `ud_views_delete` — only if user asks |
| Delete dataset | `ud_datasets_delete` — only if user asks |

## Composition & props

- One `ud_screen_show` = one widget. More widgets: `replace: false`.
- Size tokens (text): `xs` | `sm` | `md` | `lg` | `xl` | `2xl`
- **Icon** sizes (dedicated px, same trick as Omarchy weather: raw `pixelSize`, not `Style.font`): `xs`…`6xl` | `hero`
  - `2xl` / `hero` = **64px** (native weather panel hero)
  - `3xl`…`6xl` = 80 / 96 / 128 / 160 — use these next to large Stats
- **Screen placement** (top-level on `ud_screen_show`, not inside `props`):
  - `column` — **1-based** start column (`1` … `grid.columns`). Never `0`.
  - `index` — **0-based row** (same value = same horizontal band across columns). Not “add order”.
  - `colspan` — width in columns (default `1`; full-width hero uses all columns).
  - Omit `column` → horizontal-first auto-flow (fills left→right, then wraps).
- Default grid: **3 columns**. Widen with `ud_screen_grid` `{ "columns": N }` (1–26). This is **not** the IR `Grid` widget (`props.cols`).
- Side-by-side on one row: **same `index`**, consecutive `column`s (e.g. icon `column:1,index:1` + stat `column:2,index:1`).

## Widgets (MVP)

Rendered: `Stack`, `Group`, `Grid`, `Container`, `Panel`, `Card`, `ScrollArea`, `Title`, `Text`, `Markdown`, `Icon`, `Badge`, `Stat`, `Divider`, `Table`, `HorizontalTiles`, `Chart`.

Placeholder: `Map`, `List`, `Timeline`, `Image`, `Button`. (`Chart` kinds `heatmap` / `treemap` / `radar` are stubs.)

`Markdown` = short prose / notes only — **not** for live metrics.

`Table` = numeric/text columns (`columns: [{ label, field }, …]`). **Not** for hour→icon strips.

`HorizontalTiles` = stamp `children[]` once per dataset row into a horizontal band/grid. Prefer for forecasts / chip rows / hourly glyphs (`cols`, `limit`; default `layout: "grid"`). Template fields (`glyphField` / `textField` / `field`) bind to **each row** (no per-child `dataset` needed). (`Repeat` is a legacy alias.)

`Chart` = dataset rows plotted with `props: { kind, dataset, x, y: [field…], height? }`. Drawn kinds: `line`, `area`, `bar`, `barStacked`, `scatter`, `pie`, `donut`, `gauge`. Call `ud_widgets_spec` `{ "type": "Chart" }` for the full schema.

### Patterns (domain-agnostic)

**Live bind** — after upsert + refresh:

```json
{
  "widget": {
    "id": "metric-a",
    "type": "Stat",
    "props": { "label": "…", "dataset": "<key>", "field": "<field>" }
  },
  "column": 1,
  "index": 0,
  "view": { "slug": "<slug>", "title": "<title>" }
}
```

**Icon from data** — `props`: `{ "dataset": "<key>", "glyphField": "<field>", "size": "hero" }` (or `3xl`…`6xl`) where that field holds a single glyph character. Prefer `hero`/`2xl`+ next to Stats — not `md`.

**Hourly / forecast strip (`HorizontalTiles`)** — array dataset of `{ h, glyph, … }`:

```json
{
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
  "column": 1,
  "colspan": 3,
  "index": 2,
  "replace": false
}
```

**Table** — dense numbers only (not icon strips):

```json
{
  "widget": {
    "id": "rows",
    "type": "Table",
    "props": {
      "dataset": "<key>",
      "columns": [
        { "label": "…", "field": "<a>" },
        { "label": "…", "field": "<b>" }
      ]
    }
  },
  "column": 1,
  "colspan": 3,
  "index": 2,
  "replace": false
}
```

**Chart** — array dataset; `x` = category field, `y` = one or more numeric fields:

```json
{
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
  "column": 1,
  "colspan": 3,
  "index": 3,
  "replace": false
}
```

**One-shot** (no refresh):

```json
{
  "widget": {
    "id": "note",
    "type": "Stat",
    "props": { "label": "…", "field": "value" },
    "data": { "value": 0 }
  },
  "view": { "slug": "<slug>", "title": "<title>" }
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
