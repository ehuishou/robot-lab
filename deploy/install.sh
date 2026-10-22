#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if docker container inspect robot-lab >/dev/null 2>&1; then
    echo 'robot-lab exists; use deploy/update.sh' >&2
    exit 1
fi
exec bash deploy/update.sh
