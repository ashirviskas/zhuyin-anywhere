#!/bin/sh
# Runs a command from tools/ in Node + Playwright: the local ones if installed, else the Playwright container.
#   sh tools/run.sh test            syntax check + every tools/tests/*.test.js
#   sh tools/run.sh test settings   one test file
#   sh tools/run.sh images          node build.js (README images)
#   sh tools/run.sh poster          node build.js --poster
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble   # must match playwright in tools/assets/package-lock.json
if command -v node >/dev/null 2>&1; then
  W=$ROOT; run() { (cd "$W/tools/assets" && "$@"); }
else
  RT=$(command -v podman || command -v docker) || { echo 'Need Node 18+ or podman/docker' >&2; exit 1; }
  W=/w; run() { "$RT" run --rm --ipc=host -v "$ROOT":/w:Z -w /w/tools/assets "$IMAGE" "$@"; }
fi
case "${1:-test}" in
  test)
    run node --check "$W/zhuyin-anywhere.user.js"
    status=0
    for f in "$ROOT"/tools/tests/${2:-*}.test.js; do
      echo "== $(basename "$f")"
      run node "$W/tools/tests/$(basename "$f")" || status=1
    done
    exit $status ;;
  images) run node build.js ;;
  poster) run node build.js --poster ;;
  *) sed -n 3,6p "$0"; exit 1 ;;
esac
