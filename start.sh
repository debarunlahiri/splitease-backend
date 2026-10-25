#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required." >&2; exit 1; }
exec python3 "$PROJECT_ROOT/scripts/lifecycle.py" start "$@"
