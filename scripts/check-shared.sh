#!/usr/bin/env bash
# src/shared/ is a copy of typst-editor/shared/ (a sibling checkout, when present).
# A stale copy means a fix landed on one side only.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
owner="$(dirname "$root")/typst-editor/shared"
[ -d "$owner" ] || { echo "check-shared: no sibling typst-editor checkout; skipped"; exit 0; }
for f in "$root"/src/shared/*.ts; do
  if ! diff -q <(tail -n +3 "$f") "$owner/$(basename "$f")" >/dev/null; then
    echo "error: $f differs from $owner/$(basename "$f"); run scripts/sync-shared.sh $(dirname "$owner") (or copy the other way) first" >&2
    exit 1
  fi
done
echo "check-shared: ok"
