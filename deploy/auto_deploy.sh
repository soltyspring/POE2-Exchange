#!/bin/sh
set -eu

repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
runtime="$repo/runtime"
node_bin="${POE_NODE_BIN:-$HOME/.nvm/versions/node/v22.23.2/bin}"
branch="${POE_DEPLOY_BRANCH:-main}"

mkdir -p "$runtime"
exec /usr/bin/flock -n "$runtime/deploy.lock" sh -c '
  set -eu
  repo="$1"
  runtime="$2"
  node_bin="$3"
  branch="$4"

  cd "$repo"
  git fetch --quiet origin "$branch"
  target="$(git rev-parse "origin/$branch")"
  deployed="$(cat "$runtime/deployed_commit" 2>/dev/null || true)"
  [ "$deployed" != "$target" ] || exit 0

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "$(date -Is) deployment skipped: tracked files have local changes"
    exit 1
  fi

  echo "$(date -Is) deploying $(git rev-parse HEAD) -> $target"
  git pull --ff-only --quiet origin "$branch"
  [ "$(git rev-parse HEAD)" = "$target" ] || { echo "deployment requires a fast-forward to $target"; exit 1; }
  "$repo/backend/.venv/bin/pip" install --quiet -r "$repo/backend/requirements.txt"
  "$repo/backend/.venv/bin/python" -m compileall -q "$repo/backend"

  export PATH="$node_bin:$PATH"
  cd "$repo/frontend"
  npm ci --silent
  npm run build

  pkill -f "[u]vicorn app:app --host 127.0.0.1 --port 18080" || true
  sleep 1
  nohup "$repo/deploy/run_collector.sh" >> "$runtime/collector.log" 2>&1 </dev/null &
  printf "%s\n" "$target" > "$runtime/deployed_commit"
  echo "$(date -Is) deployed $(git -C "$repo" rev-parse --short HEAD)"
' sh "$repo" "$runtime" "$node_bin" "$branch"
