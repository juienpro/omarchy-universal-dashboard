#!/usr/bin/env bash
# Install / refresh this checkout into ~/.config/omarchy/plugins without
# copying node_modules (Omarchy rejects symlinks inside plugins).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/.config/omarchy/plugins/juienpro.universal-dashboard"

if [[ ! -x "$ROOT/bin/universal-dashboard" ]]; then
  echo "missing bin/universal-dashboard — run: npm install && npm run build" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .cursor \
  --exclude .forgejo \
  --exclude .mcp.json \
  --exclude mcp/node_modules \
  --exclude mcp/dist \
  --exclude '*.sav' \
  --exclude .env \
  "$ROOT/" "$DEST/"

omarchy-plugin-validate "$DEST"
echo "Installed to $DEST"
echo "Enable with: omarchy plugin enable juienpro.universal-dashboard"
echo "MCP:         claude mcp add universal-dashboard -- $DEST/bin/universal-dashboard serve"
