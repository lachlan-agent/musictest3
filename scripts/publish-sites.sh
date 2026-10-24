#!/usr/bin/env bash
# Builds this app and vendors the bundle into a checkout of the `sites` repo,
# which only publishes it (GitHub Pages). This repo stays the source of truth.
#
#   scripts/publish-sites.sh ../sites    # then review, commit and push in sites
set -euo pipefail

sites=${1:?usage: publish-sites.sh <path-to-sites-checkout>}
sites=$(cd "$sites" && pwd)
dest="$sites/musictest3"
root=$(cd "$(dirname "$0")/.." && pwd)

cd "$root"
# The shared sources are owned by the typst-editor repo (a sibling checkout, if present);
# a stale copy here means a fix landed on one side only.
owner="$(dirname "$root")/typst-editor/shared"
if [ -d "$owner" ]; then
  for f in src/shared/*.ts; do
    if ! diff -q <(tail -n +3 "$f") "$owner/$(basename "$f")" >/dev/null; then
      echo "error: $f differs from $owner/$(basename "$f"); run scripts/sync-shared.sh $(dirname "$owner") (or copy the other way) first" >&2
      exit 1
    fi
  done
fi
npm run build
rm -rf "$dest"
mkdir -p "$dest"
# Source maps stay out: this repo is private, the sites repo's output is not.
(cd dist && find . -type f ! -name '*.map' -exec cp --parents {} "$dest" \;)
echo "musictest3 @ $(git rev-parse --short HEAD) -> $dest"
