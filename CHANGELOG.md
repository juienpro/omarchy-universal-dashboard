# Changelog

All notable changes to Universal Dashboard are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
