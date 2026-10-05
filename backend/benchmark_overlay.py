"""Read-only local ASGI benchmark and source-age/index audit (no network)."""
import asyncio
import json
import math
import statistics
import time
from unittest.mock import AsyncMock, patch

import httpx
import app


async def main():
    db = app.connect()
    try:
        league = db.execute('SELECT league FROM markets GROUP BY league ORDER BY COUNT(*) DESC LIMIT 1').fetchone()[0]
        rows = db.execute('SELECT id,category FROM markets WHERE league=? ORDER BY id LIMIT 30', (league,)).fetchall()
        ages = [dict(r) for r in db.execute(
            'SELECT category, COUNT(*) AS count, MIN(observed_at) AS oldest, MAX(observed_at) AS newest '
            'FROM markets WHERE league=? GROUP BY category', (league,))]
        plan = [tuple(r) for r in db.execute('EXPLAIN QUERY PLAN SELECT id FROM markets WHERE league=? ORDER BY id', (league,))]
    finally:
        db.close()
    body = dict(league=league, items=[dict(key=r['id'], id=r['id'],
                kind='unique' if r['category'].startswith('Unique') else 'consumable') for r in rows])
    samples, sizes, wire_sizes = [], [], []
    with patch.object(app.collector, 'get_leagues', AsyncMock(return_value=[{'id': league}])):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://local') as client:
            cold_start = time.perf_counter()
            cold = await client.post('/api/overlay/prices', json=body)
            cold_ms = (time.perf_counter() - cold_start) * 1000
            cold.raise_for_status()
            for _ in range(100):
                start = time.perf_counter()
                response = await client.post('/api/overlay/prices', json=body)
                response.raise_for_status()
                samples.append((time.perf_counter() - start) * 1000)
                sizes.append(len(response.content))
                wire_sizes.append(int(response.headers.get('content-length', len(response.content))))
    print(json.dumps(dict(league=league, mode='local ASGI; excludes network/server deployment',
        requested=len(rows), coldMs=round(cold_ms, 3), coldTiming=cold.headers['server-timing'],
        p50Ms=round(statistics.median(samples), 3), p95Ms=round(sorted(samples)[math.ceil(len(samples)*.95)-1], 3),
        decodedBytes=max(sizes), encodedBodyBytes=max(wire_sizes), queryPlan=plan, sourceAges=ages), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
