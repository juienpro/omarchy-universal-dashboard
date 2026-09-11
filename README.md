# Universal Dashboard

One Omarchy bar plugin instead of a pile of tiny ones. Ask your AI agent to build the dashboards you need — weather, markets, status, whatever — and they show up in a panel that feels native to Omarchy.

You describe what you want. The agent lays it out. Data refreshes on its own. Your desktop stays yours.

## Demo

https://github.com/user-attachments/assets/e6912cd5-7948-44db-b732-82379413cf0c

## Features

- **One plugin, many dashboards** — stop installing a widget per use case
- **Agent-built layouts** — create and update views from your coding harness
- **Live data, deterministic retrieval** — define a source once (HTTP or derived); the plugin caches and refreshes on a schedule — the agent does not poll
- **Views management** — list (`V`), delete (`d`), and switch (`←`/`→` or `n`/`p`) saved dashboards
- **Overlays** — shared widgets that stay put while you switch views (`float` on top or `dock` that reserves space); survives carousel transitions; apply to all views or a subset
- **Carousel** — auto-cycle saved views on a timer (`c`, or MCP `ud_view_carousel`); `Shift+C` cycles transition (fade / slide / scale); `+` / `-` adjust delay while auto-cycle is on
- **Native Omarchy UX** — bar icon, shortcuts, and your theme

### Supported widgets

Layout: `Stack`, `Group`, `Grid`, `Container`, `Panel`, `Card`, `ScrollArea`, `Divider`

Content: `Title`, `Text`, `Markdown`, `Icon`, `Badge`, `Stat`, `Marquee`

Data: `Table`, `HorizontalTiles`, `List`, `Timeline`, `Chart`

Media & actions: `Image`, `Video`, `Youtube`, `Anchor`, `Button`

`Video` / `Youtube` need `qt6-multimedia`; `Youtube` also needs `yt-dlp` (direct stream via yt-dlp, not a browser iframe).

## Requirements

- **[Omarchy](https://omarchy.org/)** with the shell bar (Quickshell)
- **Node.js** on `PATH` (the MCP/CLI is a bundled Node script — no `npm install` for end users)
- An agent harness that can run MCP over stdio (Claude Code, Codex, etc.)
- **`yt-dlp`** on `PATH` if you use the `Youtube` widget (stream resolve + signature refresh)
- **`qt6-multimedia`** for `Video` / `Youtube` playback

## Install

```bash
omarchy plugin add https://github.com/juienpro/omarchy-universal-dashboard --enable
```

### MCP

Point your harness at the plugin binary:

```bash
claude mcp add universal-dashboard -- \
  ~/.config/omarchy/plugins/juienpro.universal-dashboard/bin/universal-dashboard serve

codex mcp add universal-dashboard -- \
  ~/.config/omarchy/plugins/juienpro.universal-dashboard/bin/universal-dashboard serve
```

Or a generic `mcpServers` entry:

```json
{
  "mcpServers": {
    "universal-dashboard": {
      "command": "~/.config/omarchy/plugins/juienpro.universal-dashboard/bin/universal-dashboard",
      "args": ["serve"]
    }
  }
}
```

### Skill

Load (or symlink) the skill shipped with the plugin:

`~/.config/omarchy/plugins/juienpro.universal-dashboard/skills/universal-dashboard/SKILL.md`

## Usage

Click the dashboard icon on the bar, or:

```bash
omarchy-shell juienpro.universal-dashboard toggle
```

### Global shortcut (optional)

Add a Hyprland binding in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + CTRL + U", "Universal Dashboard", "omarchy-shell juienpro.universal-dashboard toggle")
```

Omarchy reloads Hyprland on save. Suggested chord: **SUPER + CTRL + U** (same family as Audio / Bluetooth / Display).

### Panel shortcuts

| Key | Action |
|---|---|
| `←` / `→` or `n` / `p` | Cycle saved views |
| `c` | Toggle auto-cycle (carousel) |
| `Shift+C` | Cycle transition animation (fade → slide → scale) |
| `+` / `-` | Adjust carousel delay (only while auto-cycle is on; toast shows current seconds) |
| `V` | View list (↑↓ + Enter) |
| `d` | Delete view (press again to confirm) |
| `Esc` | Cancel / close list / close window |

## How it works

| Layer | Role |
|---|---|
| **View** | Layout of widgets on the panel |
| **Overlay** | Shared widgets that stay while views change — `float` (superimposed) or `dock` (pushes/reserves space); optional view subset |
| **Dataset** | Named data cache with a fetch schedule |
| **Source** | HTTP URL **or** one/more parent datasets (optional path + transform), refreshed automatically |

The agent builds views and wires widgets to datasets. The plugin refreshes due datasets on open and about every 30 seconds. One-off data can still be pushed for a single screen without a scheduled source.

A dataset may derive from parents: `source.dataset` (one) or `source.datasets` (two+, transform gets `{ [key]: data }`). Cycles are rejected. Refreshing any parent cascades to dependents.

## MCP tools (`ud_`)

| Tool | Purpose |
|---|---|
| `ud_view_list` | List saved views |
| `ud_view_get` | Read one view by UUID (`id` required) |
| `ud_view_create` | Create empty view (`slug`, optional `title`) — does not change the live panel |
| `ud_view_patch` | Patch view by `id`: `slug`/`title`, `grid`, and/or widgets `op` (`upsert` / `remove` / `replace_all` / `clear`) |
| `ud_view_delete` | Delete a view by UUID |
| `ud_view_carousel` | Toggle auto-cycle of views (`enabled`, optional `views[]`, `intervalSec`, `transition`) |
| `ud_overlay_list` | List saved overlays |
| `ud_overlay_get` | Read one overlay by UUID |
| `ud_overlay_create` | Create empty overlay (`slug`, `mode`, `anchor`; optional size / opacity / order / `views[]`) |
| `ud_overlay_patch` | Patch overlay size/placement and/or widgets (same widget ops as views) |
| `ud_overlay_delete` | Delete an overlay by UUID |
| `ud_screen_get` | Live panel (IR + layout + `activeViewId` + matching overlays) |
| `ud_screen_load` | Load a saved view onto the live panel by UUID |
| `ud_screen_clear` | Clear live panel (`activeViewId` null; views kept) |
| `ud_widgets_spec` | Widget props (JSON Schema); optional `{ type }` filter |
| `ud_datasets_upsert` | Create/update a dataset (HTTP, single parent, or multi-parent); on update, omit `source` / interval / transform to keep existing |
| `ud_datasets_get` | Read one dataset |
| `ud_datasets_list` | List datasets |
| `ud_datasets_refresh` | Force-refresh one dataset |
| `ud_datasets_delete` | Delete a dataset |

CLI helpers (same binary): `status`, `views`, `overlays`, `datasets`, `carousel` (`toggle` / `off` / `cycle-transition` / `interval ±N`), `load-view`, `delete-view`, `refresh`, `refresh-due`, `youtube-resolve`, `doctor`.

## State

| Path | Role |
|---|---|
| `~/.local/state/universal-dashboard/screen.json` | Live screen (includes matching overlays) |
| `~/.local/state/universal-dashboard/views.json` | View index |
| `~/.local/state/universal-dashboard/views/<id>.json` | Saved view bodies |
| `~/.local/state/universal-dashboard/overlays.json` | Overlay index |
| `~/.local/state/universal-dashboard/overlays/<id>.json` | Saved overlay bodies |
| `~/.local/state/universal-dashboard/carousel.json` | Auto-cycle on/off, view pool, interval, transition |
| `~/.local/state/universal-dashboard/datasets.json` | Dataset index |
| `~/.local/state/universal-dashboard/datasets/<key>.json` | Source, schedule, cached payload |

### Backup / restore

Copy or replace the whole tree at `~/.local/state/universal-dashboard/` (views, datasets, overlays, carousel, and live screen).

## Developing

Rebuild the MCP binary after changing TypeScript sources:

```bash
npm install && npm run build
./scripts/install-local.sh   # optional: copy into ~/.config/omarchy/plugins
```

| Path | Role |
|---|---|
| `manifest.json` | Omarchy plugin metadata |
| `qml/` | Bar widget, panel, IR renderer |
| `bin/` | Bundled MCP + CLI (`universal-dashboard`, `quickjs.wasm`) |
| `mcp/` | MCP TypeScript source |
| `packages/ir` | View IR schema |
| `skills/universal-dashboard` | Harness skill |
| `examples/` | Concise agent prompts to exercise weather, markets, news, YouTube grid, overlays |

## License

MIT
