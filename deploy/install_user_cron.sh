#!/bin/sh
set -eu
repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/runtime" "$repo/data"
entry="* * * * * $repo/deploy/run_collector.sh >> $repo/runtime/collector.log 2>&1 # poe2-market"
if crontab -l 2>/dev/null | grep -Fq '# poe2-market'; then
  echo 'POE2 collector cron entry already installed'
else
  { crontab -l 2>/dev/null || true; printf '%s\n' "$entry"; } | crontab -
  echo 'POE2 collector cron entry installed'
fi
