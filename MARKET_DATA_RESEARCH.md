# POE2 Market data collection notes (2026-09-28)

## Current app policy

- Full poe.ninja economy overview: local refresh attempt every 15 minutes.
- Selected market category: local refresh attempt every 1 minute while viewed.
- Chart snapshots: one row per minute for tracked items.
- POE2Scout reference: 60-second local cache.
- GGG Trade2 web listings: opt-in for major currencies only (`divine`, `chaos`, `annul`), 30-second local cache by default. Exalted is the reference unit.
- League/metadata: 60-minute cache.

Environment overrides:

- `POE_MARKET_POLL_SECONDS` (minimum 300)
- `POE_SELECTED_POLL_SECONDS` (minimum 60)
- `POE_SCOUT_POLL_SECONDS` (minimum 60)
- `POE_TRADE2_LIVE=1` to enable the unsupported Trade2 web source (disabled by default)
- `POE_TRADE2_LIVE_SECONDS` (minimum 15; default 30)
- `POE_TRADE2_MIN_GAP_SECONDS` (minimum 2; default 3)

## What each source actually means

### poe.ninja PoE2 economy

Supported public economy endpoints. Their own docs say responses are HTTP-cached around five minutes, and the underlying PoE2 economy data refreshes roughly hourly. Polling every minute cannot create fresher upstream data. Good for the full 1,000+ item market table, trend, volume, and unique-item aggregate estimates.

### GGG official Currency Exchange public API

`GET https://api.pathofexile.com/currency-exchange/poe2[/<id>]` (requires `service:cxapi` OAuth scope)

This is completed Currency Exchange activity grouped into hourly digests. It is authoritative for executed exchange history, but not a current order book and not a 1-minute source.

Reference: [GGG Currency Exchange API documentation](https://www.pathofexile.com/developer/docs/reference#currencyexchange).

### GGG Trade2 web endpoint (unsupported/internal)

`POST https://www.pathofexile.com/api/trade2/exchange/poe2/{league}`

The official trade website and multiple open-source tools use this endpoint for the live bulk order book. It returns current listings/offers, not completed trades. It is not part of GGG's supported developer API. Rate-limit headers and `Retry-After` must be honored.

GGG states that internal trade-site APIs are outside its supported offering and warns against reverse engineering undocumented endpoints: [developer documentation](https://www.pathofexile.com/developer/docs), [GGG staff reply](https://www.pathofexile.com/forum/view-thread/3444007).

If explicitly enabled, our app uses it only for major-currency pairs. The displayed quote is a filtered median of available listings, and the chart records those listing observations separately from poe.ninja price observations. This source may fail or change without notice; it is not a completed-trade feed.

### POE2Scout

Useful public API for price history, icons, categories and pair snapshots. It is a strong secondary/fallback source, but it should not be treated as a genuine one-minute executed-trade tape. Local polling can be fast while its upstream values remain unchanged.

## Why true 1-minute executed candles are not available

GGG's official completed-trade feed is hourly. The Trade2 endpoint is a live listing/order-book view, not a trade tape. Therefore the 1-minute chart is an observation chart. When enabled and available for a major currency, it uses the separate Trade2 listing-observation series. Otherwise it uses the poe.ninja aggregate-observation series; these two series are not mixed into one candle.

## UI time-axis fix

5-minute, 1-hour, and 1-day axis labels are now normalized to their selected interval. The backend already buckets using epoch-aligned intervals; the frontend now prevents auto-generated labels such as `:36` or `:41` from being shown on a 5-minute chart. The `Invalid Date` case for an empty next-refresh list is also fixed.
