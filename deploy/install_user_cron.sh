#!/bin/sh
set -eu
repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/runtime" "$repo/data"
collector="* * * * * $repo/deploy/run_collector.sh >> $repo/runtime/collector.log 2>&1 # poe2-market"
deploy="* * * * * $repo/deploy/auto_deploy.sh >> $repo/runtime/deploy.log 2>&1 # poe2-auto-deploy"
history="17 4 * * * cd $repo/backend && /usr/bin/flock -n $repo/runtime/scout-backfill.lock $repo/backend/.venv/bin/python backfill_scout.py --league 'Forbidden Rites' --limit 1000 --pause 0.5 >> $repo/runtime/scout-backfill.log 2>&1 # poe2-scout-history"
current="$(crontab -l 2>/dev/null | grep -v '# poe2-market' | grep -v '# poe2-auto-deploy' | grep -v '# poe2-scout-history' || true)"
{ [ -n "$current" ] && printf '%s\n' "$current" || true; printf '%s\n%s\n%s\n' "$collector" "$deploy" "$history"; } | crontab -
echo 'POE2 collector and automatic deployment cron entries installed'
