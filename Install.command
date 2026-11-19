#!/usr/bin/env bash
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/install.sh" "$@"
RESULT=$?
echo
read -r -p "Press Enter to close…" _
exit "$RESULT"
