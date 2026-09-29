# POE2 Market refresh policy

- Full market (poe.ninja categories): 15 minutes by default
- Selected market category: 1 minute by default
- POE2Scout selected currency reference: 60 seconds
- Full-market SQLite snapshots: every 15 minutes after source validation, retained until manually archived
- Chart snapshots: every 1 minute for items viewed during the past 24 hours
- League / metadata cache: 60 minutes
- Manual refresh: selected market only, bypasses local cache and conditional ETag/Last-Modified headers
- HTTP protection: shared concurrency limit, Retry-After support, exponential backoff for 429/502/503/504

Environment variables:

- `POE_MARKET_POLL_SECONDS` default `900`
- `POE_SELECTED_POLL_SECONDS` default `60`
- `POE_HISTORY_SNAPSHOT_SECONDS` default `900`
- `POE_TRACKED_ACTIVE_SECONDS` default `86400`
- `POE_SCOUT_POLL_SECONDS` default `60`
- `POE_LEAGUE_CACHE_SECONDS` default `3600`

The frontend no longer downloads the full market every minute. It refreshes the full list on the market cadence, while the chart endpoint refreshes only the selected item's category and keeps one-minute local observations.

The official GGG Currency Exchange API remains a separate historical hourly digest source. It is not used as a current-price feed in this revision.
