#!/usr/bin/env bash
set -euo pipefail

# Launch from the repository root even when called from another directory.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { echo "Node.js 24 is required." >&2; exit 1; }
exec node scripts/run.mjs "$@"
