"""Compact, snapshot-only overlay quotes; never queries external trade services."""
import hashlib
import json
import threading
import time
from collections import defaultdict

from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel, Field


class OverlayItem(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    id: str | None = Field(default=None, max_length=300)
    name: str | None = Field(default=None, max_length=300)
    baseType: str | None = Field(default=None, max_length=300)
    kind: str = Field(max_length=40)
    variant: str | None = Field(default=None, max_length=100)
    tier: int | None = Field(default=None, ge=0, le=100)
    level: int | None = Field(default=None, ge=0, le=100)


class OverlayRequest(BaseModel):
    league: str = Field(min_length=1, max_length=120)
    items: list[OverlayItem] = Field(max_length=500)


def normalized(value):
    return " ".join((value or "").casefold().split())


class SnapshotStore:
    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def invalidate(self, league):
        with self.lock:
            self.cache.pop(league, None)

    def get(self, league, connect):
        start = time.perf_counter()
        # Share both cache loads and completed immutable snapshots across requests.
        with self.lock:
            cached = self.cache.get(league)
            if cached and time.monotonic() - cached[0] < 60:
                return cached[1], 0, (time.perf_counter() - start) * 1000
            db_start = time.perf_counter()
            db = connect()
            try:
                rows = [dict(row) for row in db.execute(
                    "SELECT m.id,m.category,m.name,m.base_type,m.price_divine,m.listing_count,"
                    "m.observed_at,m.source_kind,d.variant FROM markets m LEFT JOIN market_metadata d "
                    "ON d.league=m.league AND d.market_id=m.id WHERE m.league=? ORDER BY m.id", (league,))]
            finally:
                db.close()
            db_ms = (time.perf_counter() - db_start) * 1000
            by_id = {row['id']: row for row in rows}
            by_name = defaultdict(list)
            for row in rows:
                by_name[normalized(row['name'])].append(row)
            version = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()[:20]
            snapshot = (by_id, by_name, version)
            self.cache[league] = (time.monotonic(), snapshot)
            return snapshot, db_ms, 0


def quotes(payload, snapshot, now):
    by_id, by_name, version = snapshot
    exalted = by_id.get('exchange:Currency:exalted')
    fresh_rate = exalted and 0 <= now - exalted['observed_at'] <= 1800 and exalted['price_divine'] > 0
    rate = 1 / exalted['price_divine'] if fresh_rate else None
    results = {}
    for item in payload.items:
        if item.key in results:
            continue
        kind = normalized(item.kind)
        unique = kind in {'unique', '고유'}
        consumable = kind in {'currency', 'consumable', '화폐', '소모품'}
        tablet = kind in {'tablet', 'precursortablet', '서판', '선대 서판'}
        candidates = [by_id[item.id]] if item.id in by_id else by_name.get(normalized(item.name), [])
        # Unsupported dimensions must never fall back to an unrelated aggregate.
        candidates = [r for r in candidates if item.tier is None and item.level is None
                      and ((unique and r['category'].startswith('Unique'))
                           or (consumable and r['source_kind'] in {'exchange', 'reference'})
                           or (tablet and r['category'] == 'PrecursorTablets'))
                      and (not item.variant or normalized(item.variant) == normalized(r.get('variant')))
                      and (not item.baseType or normalized(item.baseType) == normalized(r['base_type']))]
        row = candidates[0] if len(candidates) == 1 else None
        state = 'missing' if row is None else ('ready' if 0 <= now - row['observed_at'] <= 1800 else 'stale')
        price_kind = 'unique_reference' if unique else 'tablet_reference' if tablet else 'consumable_reference' if consumable else None
        results[item.key] = dict(
            id=row['id'] if row else None,
            name=item.name, baseType=item.baseType, kind=item.kind, variant=row.get('variant') if row else item.variant,
            priceExalted=row['price_divine'] * rate if state == 'ready' and rate else None,
            priceDivine=row['price_divine'] if state == 'ready' else None,
            priceKind=price_kind if row else None,
            observedAt=row['observed_at'] if row else None,
            source=row['source_kind'] if row else None,
            sampleCount=row['listing_count'] if row else None, state=state)
    return dict(items=results, snapshotVersion=version,
                rates=dict(exaltedPerDivine=rate,
                           observedAt=exalted['observed_at'] if exalted else None,
                           state='ready' if fresh_rate else 'stale' if exalted else 'missing'),
                state='ready' if by_id else 'collecting')


def overlay_response(payload, snapshot, request: Request, db_ms=0, cache_ms=0):
    start = time.perf_counter()
    body = json.dumps(quotes(payload, snapshot, int(time.time())),
                      ensure_ascii=False, separators=(',', ':')).encode()
    etag = '"' + hashlib.sha256(body).hexdigest() + '"'
    headers = {'ETag': etag, 'Cache-Control': 'private, no-cache',
               'Server-Timing': f'db;dur={db_ms:.3f}, serialize;dur={(time.perf_counter()-start)*1000:.3f}, cache;dur={cache_ms:.3f}'}
    if etag in request.headers.get('if-none-match', '').split(', ') or request.headers.get('if-none-match') == '*':
        return Response(status_code=304, headers=headers)
    return Response(body, media_type='application/json', headers=headers)
