# Changelog

All notable changes to Universal Dashboard are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-08

### Added

- Omarchy bar plugin (`juienpro.universal-dashboard`) with floating panel, keyboard view switching, and theme-aware UI
- Agent MCP/CLI surface (`ud_*` tools) shipped as `bin/universal-dashboard` + `bin/quickjs.wasm` (no end-user `npm install`)
- Persisted datasets with per-source HTTP refresh, optional QuickJS transforms, and saved views
- IR → QML renderer (tables, charts, tiles, stats, and related widgets)
- Harness skill at `skills/universal-dashboard`
- Install via `omarchy plugin add`, release tooling (`scripts/release.sh`, GitHub Actions, CHANGELOG)
