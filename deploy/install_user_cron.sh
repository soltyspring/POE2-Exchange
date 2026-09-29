#!/bin/sh
set -eu
repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/runtime" "$repo/data"
collector="* * * * * $repo/deploy/run_collector.sh >> $repo/runtime/collector.log 2>&1 # poe2-market"
deploy="* * * * * $repo/deploy/auto_deploy.sh >> $repo/runtime/deploy.log 2>&1 # poe2-auto-deploy"
current="$(crontab -l 2>/dev/null | grep -v '# poe2-market' | grep -v '# poe2-auto-deploy' || true)"
{ [ -n "$current" ] && printf '%s\n' "$current" || true; printf '%s\n%s\n' "$collector" "$deploy"; } | crontab -
echo 'POE2 collector and automatic deployment cron entries installed'
