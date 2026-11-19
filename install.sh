#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if command -v node >/dev/null 2>&1; then
  exec node "$HERE/install.mjs" "$@"
elif command -v bun >/dev/null 2>&1; then
  exec bun "$HERE/install.mjs" "$@"
else
  echo "Please install Node.js 20+ or Bun, then run this installer again." >&2
  exit 1
fi
