#!/usr/bin/env bash
# Cut a release: sync versions → typecheck → build bin/ → validate → commit → tag.
# Does not push (you do that).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "release: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh <x.y.z>     # set exact version
  ./scripts/release.sh patch|minor|major

Steps:
  1. Require a clean git working tree
  2. Bump version in manifest.json + package.json workspaces
  3. npm ci && typecheck && build (refreshes bin/)
  4. Validate plugin layout (no node_modules)
  5. Ensure CHANGELOG has a section for this version
  6. Commit + annotated tag vX.Y.Z

Then:
  git push origin HEAD
  git push origin vX.Y.Z
EOF
}

[[ ${1:-} == -h || ${1:-} == --help ]] && { usage; exit 0; }
[[ $# -eq 1 ]] || die "expected one argument (try --help)"

current="$(jq -r '.version' "$ROOT/manifest.json")"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] ||
  die "manifest version '$current' is not semver x.y.z"

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

case "$1" in
  patch) next="$major.$minor.$((patch + 1))" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  major) next="$((major + 1)).0.0" ;;
  *)
    [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version '$1'"
    next="$1"
    ;;
esac

[[ "$next" != "$current" ]] || die "already at $current"

git rev-parse --is-inside-work-tree >/dev/null
if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is dirty — commit or stash first"
fi

tag="v$next"
if git rev-parse "$tag" >/dev/null 2>&1; then
  die "tag $tag already exists"
fi

echo "release: $current → $next"

# Sync versions (source of truth for users: manifest.json)
for f in manifest.json package.json mcp/package.json packages/ir/package.json; do
  [[ -f "$f" ]] || die "missing $f"
  tmp="$(mktemp)"
  jq --arg v "$next" '.version = $v' "$f" >"$tmp"
  mv "$tmp" "$f"
done

# Keep workspace dep pin in sync when ir version is the package version
tmp="$(mktemp)"
jq --arg v "$next" '
  if .dependencies["@eow/ir"] then .dependencies["@eow/ir"] = $v else . end
' mcp/package.json >"$tmp"
mv "$tmp" mcp/package.json

today="$(date -u +%Y-%m-%d)"
if ! grep -qE "^## \[${next}\]" CHANGELOG.md 2>/dev/null; then
  if [[ -f CHANGELOG.md ]] && grep -q '^## \[Unreleased\]' CHANGELOG.md; then
    # Insert a dated section after Unreleased (leave Unreleased empty for next cycle)
    tmp="$(mktemp)"
    awk -v ver="$next" -v day="$today" '
      BEGIN { inserted = 0 }
      /^## \[Unreleased\]/ {
        print
        print ""
        print "## [" ver "] - " day
        print ""
        print "### Changed"
        print ""
        print "- Describe this release before pushing (edit this section)."
        inserted = 1
        next
      }
      { print }
      END {
        if (!inserted) {
          print ""
          print "## [" ver "] - " day
        }
      }
    ' CHANGELOG.md >"$tmp"
    mv "$tmp" CHANGELOG.md
  else
    cat >CHANGELOG.md <<EOF
# Changelog

All notable changes to Universal Dashboard are documented here.

## [Unreleased]

## [$next] - $today

### Added

- Initial public release.

EOF
  fi
  echo "release: added CHANGELOG stub for $next — edit it before push if needed"
fi

echo "release: install + typecheck + build"
npm ci
npm run typecheck
npm run build

[[ -x bin/universal-dashboard ]] || die "bin/universal-dashboard missing after build"
[[ -f bin/quickjs.wasm ]] || die "bin/quickjs.wasm missing after build"

echo "release: validate plugin"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude .cursor \
  --exclude .forgejo \
  --exclude .mcp.json \
  --exclude mcp/node_modules \
  --exclude mcp/dist \
  --exclude '*.sav' \
  --exclude .env \
  "$ROOT/" "$stage/"
omarchy-plugin-validate "$stage"

git add manifest.json package.json package-lock.json mcp/package.json packages/ir/package.json \
  bin/universal-dashboard bin/quickjs.wasm CHANGELOG.md
git commit -m "$(cat <<EOF
Release $tag

EOF
)"
git tag -a "$tag" -m "Universal Dashboard $tag"

cat <<EOF

release: ready

  git push origin HEAD
  git push origin $tag

GitHub Actions will create the GitHub Release from the tag.
Users install / update via:

  omarchy plugin add https://github.com/juienpro/omarchy-universal-dashboard --enable
  omarchy plugin update juienpro.universal-dashboard

EOF
