#!/usr/bin/env bash
# Refreshes src/shared/ from the typst-editor repo, which owns the shared sources.
#
#   scripts/sync-shared.sh ../typst-editor
set -euo pipefail

src=${1:?usage: sync-shared.sh <path-to-typst-editor-checkout>}
root=$(cd "$(dirname "$0")/.." && pwd)
for f in windows.ts; do
  {
    echo "// GENERATED COPY. Do not edit: the source is typst-editor/shared/$f."
    echo "// Refresh with scripts/sync-shared.sh <path-to-typst-editor>; publish-sites.sh checks for drift."
    cat "$src/shared/$f"
  } > "$root/src/shared/$f"
  echo "src/shared/$f <- $src/shared/$f"
done
