# Universal Dashboard

One Omarchy bar plugin instead of a pile of tiny ones. Ask your AI agent to build the dashboards you need — weather, markets, status, whatever — and they show up in a panel that feels native to Omarchy.

You describe what you want. The agent lays it out. Data refreshes on its own. Your desktop stays yours.

## Features

- **One plugin, many dashboards** — stop installing a widget per use case
- **Agent-built layouts** — create and update views from your coding harness
- **Live data** — define a source once; the panel keeps it fresh
- **Scrolling marquee** — ticker-style text bands (`Marquee`) with live dataset binding
- **Custom refresh per data source** — each live feed has its own cache and refresh interval
- **Saved views** — switch between dashboards with the keyboard (`←`/`→` or `n`/`p`)
- **View carousel** — auto-cycle saved views on a timer (`c`, or MCP `ud_views_carousel`); `Shift+C` cycles transition (fade / slide / scale); `+` / `-` adjust delay while auto-cycle is on
- **Native Omarchy UX** — bar icon, shortcuts, and your theme

## Requirements

- **[Omarchy](https://omarchy.org/)** with the shell bar (Quickshell)
- **Node.js** on `PATH` (the MCP/CLI is a bundled Node script — no `npm install` for end users)
- An agent harness that can run MCP over stdio (Claude Code, Codex, etc.)

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
| **Dataset** | Named data cache with a fetch schedule |
| **Source** | HTTP URL **or** one/more parent datasets (optional path + transform), refreshed automatically |

The agent builds views and wires widgets to datasets. The plugin refreshes due datasets on open and about every 30 seconds. One-off data can still be pushed for a single screen without a scheduled source.

A dataset may derive from parents: `source.dataset` (one) or `source.datasets` (two+, transform gets `{ [key]: data }`). Cycles are rejected. Refreshing any parent cascades to dependents.

## MCP tools (`ud_`)

| Tool | Purpose |
|---|---|
| `ud_screen_get` | Live screen (IR + layout) |
| `ud_screen_clear` | Clear screen (datasets kept) |
| `ud_widgets_spec` | Widget props (JSON Schema); optional `{ type }` filter |
| `ud_screen_show` | Show a widget; default upsert by `id` (`replace: false`); `replace: true` wipes the screen; optional `view:{slug,title?}` to save |
| `ud_screen_grid` | Placement grid columns (1–26) |
| `ud_screen_save_view` | Save live screen as a view |
| `ud_screen_load_view` | Load a saved view |
| `ud_views_list` | List saved views |
| `ud_views_delete` | Delete a view |
| `ud_views_carousel` | Toggle auto-cycle of views (`enabled`, optional `views[]`, `intervalSec`, `transition`) |
| `ud_datasets_upsert` | Create/update a dataset (HTTP, single parent, or multi-parent) |
| `ud_datasets_get` | Read one dataset |
| `ud_datasets_list` | List datasets |
| `ud_datasets_refresh` | Force-refresh one dataset |
| `ud_datasets_delete` | Delete a dataset |

CLI helpers (same binary): `status`, `views`, `datasets`, `carousel` (`toggle` / `off` / `cycle-transition` / `interval ±N`), `load-view`, `delete-view`, `refresh`, `refresh-due`, `doctor`.

## State

| Path | Role |
|---|---|
| `~/.local/state/universal-dashboard/screen.json` | Live screen |
| `~/.local/state/universal-dashboard/views.json` | View index |
| `~/.local/state/universal-dashboard/views/<id>.json` | Saved view bodies |
| `~/.local/state/universal-dashboard/carousel.json` | Auto-cycle on/off, view pool, interval, transition |
| `~/.local/state/universal-dashboard/datasets.json` | Dataset index |
| `~/.local/state/universal-dashboard/datasets/<key>.json` | Source, schedule, cached payload |

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

## Releasing

Versions follow [semver](https://semver.org/). Keep these in sync (the release script does it):

- `manifest.json` (what Omarchy shows)
- root / `mcp` / `packages/ir` `package.json`
- `bin/` (rebuilt MCP bundle + `quickjs.wasm`)
- `CHANGELOG.md`
- git tag `vX.Y.Z`

### Cut a release

Working tree must be clean.

```bash
./scripts/release.sh patch|minor|major   # agent picks bump + writes CHANGELOG; or pass x.y.z

git push origin HEAD
git push origin vX.Y.Z        # triggers GitHub Release via Actions
```

The agent owns changelog notes, semver choice, `./scripts/release.sh`, commit, and push. The script bumps versions, runs `npm ci` + typecheck + build, validates the plugin, commits, and creates an annotated tag (it does not push).

**Bump choice:** major = breaking public contract; minor = new backward-compatible features; patch = fixes/docs/chore.

### First publish to GitHub

If you are already at `0.1.0` and have never tagged:

```bash
npm ci && npm run typecheck && npm run build
git add -A && git commit -m "Prepare 0.1.0 for GitHub"
git tag -a v0.1.0 -m "Universal Dashboard v0.1.0"
git remote add github git@github.com:juienpro/omarchy-universal-dashboard.git   # once
git push github HEAD:main
git push github v0.1.0
```

After that, always use `./scripts/release.sh`.

### What users get

| Command | Effect |
|---|---|
| `omarchy plugin add … --enable` | Clone latest `main` |
| `omarchy plugin update juienpro.universal-dashboard` | Pull latest from the install remote |

Tags / GitHub Releases are for changelogs and pinning; day-to-day Omarchy installs track the default branch unless you document otherwise.

## License

MIT
