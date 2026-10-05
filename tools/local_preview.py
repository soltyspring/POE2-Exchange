"""Read-only local UI preview using the existing SQLite snapshot.

Never starts a collector, sends refresh requests, or writes the production DB.
Run: python tools/local_preview.py (127.0.0.1:8001 only).
"""
from pathlib import Path
import hashlib
import sqlite3
import sys
import time

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'backend'))
from backend import app as service
from build_import import router as build_router


def readonly_connect():
    db = sqlite3.connect(service.DB_PATH.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    return db


service.connect = readonly_connect
app = FastAPI(title='POE2 local read-only preview')
app.include_router(build_router)


@app.get('/api/leagues')
def leagues():
    with readonly_connect() as db:
        return [{'id': row['league'], 'name': row['league']} for row in db.execute(
            'SELECT league FROM markets GROUP BY league ORDER BY MAX(observed_at) DESC')]


@app.get('/api/markets')
def markets(league: str):
    with readonly_connect() as db:
        items = [dict(row) for row in db.execute('''SELECT m.*,COALESCE(o.display_order,999999) AS display_order
            FROM markets m LEFT JOIN market_display_order o ON o.league=m.league AND o.market_id=m.id
            WHERE m.league=? ORDER BY m.category,display_order,m.id''', (league,))]
        states = [service.source_status_view(dict(row), 900, int(time.time())) for row in db.execute(
            'SELECT * FROM fetch_state WHERE league=?', (league,))]
    ex = next((m['price_divine'] for m in items if m['id'] == 'exchange:Currency:exalted'), None)
    return {'markets': items, 'categories': service.CATEGORIES, 'source_status': states,
            'exalted_per_divine': 1 / ex if ex else None, 'sample_interval_seconds': 60,
            'upstream_poll_seconds': 900, 'selected_poll_seconds': 60, 'scout_poll_seconds': 300,
            'league_cache_seconds': 3600, 'trade2_live_enabled': False, 'preview_mode': True}


@app.get('/api/candles/{market_id:path}')
def candles(market_id: str, league: str, interval: str = '1m', unit: str = 'divine', limit: int = Query(500, ge=1, le=2000)):
    seconds = {'1m': 60, '5m': 300, '1h': 3600, '1d': 86400}.get(interval)
    column = {'divine': 'price_divine', 'exalted': 'price_exalted', 'chaos': 'price_chaos'}.get(unit)
    if not seconds or not column:
        raise HTTPException(400, 'Invalid interval or unit')
    with readonly_connect() as db:
        market = db.execute('SELECT * FROM markets WHERE league=? AND id=?', (league, market_id)).fetchone()
        if not market:
            raise HTTPException(404, 'Unknown market')
        rows = db.execute(f'''SELECT minute,{column} AS price FROM observations WHERE league=? AND market_id=?
            AND {column}>0 ORDER BY minute DESC LIMIT ?''', (league, market_id, min(20000, limit * (seconds // 60)))).fetchall()
        ex = db.execute("SELECT price_divine FROM markets WHERE league=? AND id='exchange:Currency:exalted'", (league,)).fetchone()
        state = db.execute('SELECT * FROM fetch_state WHERE league=? AND category=?', (league, market['category'])).fetchone()
    buckets = {}
    for row in reversed(rows):
        bucket, value = row['minute'] // seconds * seconds, row['price']
        if bucket not in buckets:
            buckets[bucket] = {'time': bucket, 'open': value, 'high': value, 'low': value, 'close': value, 'samples': 1}
        else:
            candle = buckets[bucket]
            candle.update(high=max(candle['high'], value), low=min(candle['low'], value), close=value, samples=candle['samples'] + 1)
    return {'candles': list(buckets.values())[-limit:], 'kind': 'observed_snapshots', 'market': dict(market),
            'exalted_per_divine': 1 / ex[0] if ex and ex[0] else None, 'live_quote': None,
            'source_status': service.source_status_view(dict(state), 900, int(time.time())) if state else None}


@app.get('/api/seasonality/{market_id:path}')
def seasonality(market_id: str, league: str, days: int = Query(56, ge=7, le=365), unit: str = 'exalted'):
    if unit not in {'exalted', 'divine', 'chaos'}:
        raise HTTPException(400, 'Invalid unit')
    return service.seasonality(league, market_id, days, unit)


@app.get('/api/market-summary/{market_id:path}')
def summary(market_id: str, league: str, days: int = Query(56, ge=7, le=365), unit: str = 'exalted'):
    data = seasonality(market_id, league, days, unit)
    with readonly_connect() as db:
        row = db.execute('SELECT name FROM markets WHERE league=? AND id=?', (league, market_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Unknown market')
    return service.statistical_market_summary(row['name'], data)


@app.get('/api/market-icon/{market_id:path}')
def icon(market_id: str, league: str):
    key = hashlib.sha256(f'{league}:{market_id}'.encode()).hexdigest()
    matches = list((ROOT / 'data' / 'icon_cache').glob(key + '.*'))
    if matches:
        return FileResponse(matches[0], headers={'Cache-Control': 'public, max-age=31536000, immutable'})
    with readonly_connect() as db:
        row = db.execute('SELECT icon FROM markets WHERE league=? AND id=?', (league, market_id)).fetchone()
    if row and row['icon'] and row['icon'].startswith(('https://web.poecdn.com/', 'https://poe.ninja/')):
        return RedirectResponse(row['icon'])
    raise HTTPException(404, 'No icon in local snapshot')


@app.get('/api/scout/{market_id:path}')
def scout(market_id: str):
    raise HTTPException(404, 'External reference disabled in local preview')


@app.post('/api/refresh')
def refresh():
    raise HTTPException(409, '로컬 미리보기에서는 저장된 데이터만 확인합니다. 수집 서버에는 요청하지 않습니다.')


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8001)
