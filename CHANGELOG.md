# Changelog

All notable changes to Universal Dashboard are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-09-11

### Changed

- README Features: lead with product capabilities (views management, overlays, carousel, deterministic live data); add a Supported widgets subsection; drop ambiguous “chrome” wording for overlays.

## [1.0.0] - 2026-09-11

### Added

- Overlays: shared chrome across views (`ud_overlay_list` / `get` / `create` / `patch` / `delete`). `mode: float` superimposes; `mode: dock` reserves space and pushes the view. Anchors (edges / corners / center), optional `width`/`height` (px or `%`), `opacity`, `order`, and `views[]` (omit/`[]` = all views). Matching overlays are embedded in `screen.json` and stay put during carousel transitions. State under `overlays.json` + `overlays/<id>.json`.
- `Youtube` widget: watch URL / `videoId` → `yt-dlp` resolves a direct stream for Qt Multimedia; re-resolves on `resolveIntervalSec` (default 20 min) and on playback error. Prefers HLS / progressive formats. CLI `youtube-resolve`; `doctor` reports `yt-dlp`. Not a WebEngine iframe.
- `Video` widget: inline playback via Qt Multimedia (`src` / `srcField` + optional `dataset`); `height` or `size` (xs–2xl), `autoPlay` (default true), `sound` (default false / muted). Needs `qt6-multimedia`.
- `Youtube` / `Video`: hover chrome (`controls`, default on) — click play/pause, mute/unmute; IR `sound` is only the initial mute state. `fit` (`cover` default / `contain` / `stretch`) and optional `aspect: "16:9"`.
- `List`: card grid/stack from a dataset (`titleField`, optional `subtitleField` / `metaField` / `imageField` / `hrefField`, `layout`, `cols`, `limit`, optional `size`). http(s) via `hrefField` opens on card click.
- `Timeline`: vertical events (`titleField`, `timeField`, optional `bodyField`).
- `Image`: `src` / `srcField` (+ optional `dataset`), `alt` / `altField`, `height`, `radius`.
- `Anchor`: clickable http(s) link (`label` / `labelField`, `href` / `hrefField`, optional `dataset`, `size`).
- `Button`: labeled control with `on.click` actions `openUrl`, `navigate`, `dataset.refresh`. MCP widget upsert accepts `on`.
- `Table`: optional `size` (`xs`…`2xl`) for cell text; per-column `hrefField` opens http(s) URLs on click.
- `Text` / `Title` / `Badge`: optional `dataset` with `textField` for live binding (same runtime path as Marquee).
- `examples/`: short agent prompts for weather, stocks, HN, Omarchy RSS, YouTube grid, ticker dock overlay, and float logo.
- README: demo video, feature/requirements coverage for video/YouTube/overlays, and backup/restore note for the whole state tree.

### Changed

- **Breaking (MCP):** views vs screen split. Content mutations go through `ud_view_*` (`list` / `get` / `create` / `patch` / `delete` / `carousel`). Live panel: `ud_screen_get` / `ud_screen_load` / `ud_screen_clear`. Removed `ud_screen_show`, `ud_screen_save_view`, `ud_screen_load_view`, `ud_screen_grid`, `ud_views_list`, `ud_views_delete`, `ud_views_carousel`. `ud_view_patch` widgets ops: `upsert` | `remove` | `replace_all` | `clear`.
- `ud_screen_get` / live `screen.json` include matching `overlays` for the active view.
- `ud_widgets_spec`: `Chart` is `rendered: true`; `List` / `Timeline` / `Image` / `Button` / `Anchor` now `rendered: true` (`Map` remains placeholder).
- `ud_datasets_upsert`: `source` required only on create; updates may omit `source` / `refreshIntervalSec` / `transform` to keep existing values.
- Skill and README updated for the new MCP surface, overlays, and media widgets.

## [0.3.0] - 2026-09-09

### Added

- `Marquee` widget: seamless horizontal ticker (speed, direction, gap, pause on hover, optional overflow-only); binds `text` / `textField` + `dataset`, joins multi-row fields with `separator`
- Derived datasets: `source.dataset` (one parent) or `source.datasets` (two+; transform gets `{ [key]: data }`); cycles rejected; refreshing a parent cascades to dependents

### Changed

- `ud_screen_show`: default `replace` is now `false` (upsert by `widget.id`; other widgets kept). Pass `replace: true` only to wipe the screen and show a single widget. MCP description + skill warn against using `replace: true` for style/prop updates.

## [0.2.0] - 2026-09-09

### Added

- View carousel: MCP tool `ud_views_carousel` (`enabled`, optional `views[]`, `intervalSec`, `transition`: fade / slide / scale) with state in `carousel.json`
- Panel shortcuts: `n` / `p` cycle views; `c` toggles carousel; `Shift+C` cycles transition; `+` / `-` nudge delay while auto-cycle is on (toast shows current interval)
- CLI helper `carousel` (`toggle` / `off` / `cycle-transition` / `interval ±N`)
- Animated view transitions (fade / slide / scale) when switching saved views

## [0.1.0] - 2026-09-08

### Added

- Omarchy bar plugin (`juienpro.universal-dashboard`) with floating panel, keyboard view switching, and theme-aware UI
- Agent MCP/CLI surface (`ud_*` tools) shipped as `bin/universal-dashboard` + `bin/quickjs.wasm` (no end-user `npm install`)
- Persisted datasets with per-source HTTP refresh, optional QuickJS transforms, and saved views
- IR → QML renderer (tables, charts, tiles, stats, and related widgets)
- Harness skill at `skills/universal-dashboard`
- Install via `omarchy plugin add`, release tooling (`scripts/release.sh`, GitHub Actions, CHANGELOG)
