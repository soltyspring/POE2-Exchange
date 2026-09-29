#!/bin/sh
set -eu
repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/runtime" "$repo/data"
if [ -f "$repo/.env" ]; then
  set -a
  . "$repo/.env"
  set +a
fi
export POE_DB_PATH="$repo/data/prices.sqlite3"
export POE_DEFAULT_LEAGUE="Forbidden Rites"
export PYTHONDONTWRITEBYTECODE=1
cd "$repo/backend"
exec /usr/bin/flock -n "$repo/runtime/collector.lock" \
  "$repo/backend/.venv/bin/python" -m uvicorn app:app --host 127.0.0.1 --port 18080
