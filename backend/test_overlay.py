import gc
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import app
from overlay_prices import SnapshotStore


class OverlayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(app, 'DB_PATH', Path(self.directory.name) / 'test.sqlite3')
        self.db_patch.start()
        self.cache_patch = patch.object(app, 'overlay_snapshots', SnapshotStore())
        self.cache_patch.start()
        self.leagues_patch = patch.object(app.collector, 'get_leagues', AsyncMock(return_value=[{'id': 'Test'}]))
        self.leagues_patch.start()
        app.init_db()
        self.now = int(time.time())
        def row(id, category, name, base, price, observed):
            return (id, category, category, name, None, base, price, None, 10, None,
                    'stash' if category.startswith('Unique') else 'exchange', observed)
        app.save_markets('Test', [row('exchange:Currency:exalted', 'Currency', '엑잘티드 오브', None, .01, self.now)])
        app.save_markets('Test', [row('u1', 'UniqueArmours', '고유 장갑', '사이렌 장갑', 2, self.now),
                                 row('u2', 'UniqueArmours', '오래된 장갑', '다른 장갑', 3, self.now - 1801)])
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.leagues_patch.stop()
        self.cache_patch.stop()
        self.db_patch.stop()
        gc.collect()
        self.directory.cleanup()

    async def test_quotes_preserve_names_and_never_use_unique_as_rare_base(self):
        response = await self.client.post('/api/overlay/prices', json={'league': 'Test', 'items': [
            {'key': 'unique', 'name': '고유 장갑', 'baseType': '사이렌 장갑', 'kind': 'unique'},
            {'key': 'rare', 'id': 'u1', 'name': '슬픔의 발 사이렌 장갑', 'baseType': '사이렌 장갑', 'kind': 'rare'},
            {'key': 'stale', 'id': 'u2', 'kind': 'unique'},
            {'key': 'gem', 'kind': 'gem', 'level': 20},
            {'key': 'map', 'kind': 'waystone', 'tier': 15}]})
        self.assertEqual(response.status_code, 200)
        items = response.json()['items']
        self.assertEqual(items['unique']['priceExalted'], 200)
        self.assertEqual(items['unique']['id'], 'u1')
        self.assertIsNone(items['rare']['id'])
        self.assertEqual(items['rare']['name'], '슬픔의 발 사이렌 장갑')
        for key in ('rare', 'gem', 'map'):
            self.assertEqual(items[key]['state'], 'missing')
            self.assertIsNone(items[key]['priceExalted'])
        self.assertEqual(items['stale']['state'], 'stale')
        self.assertIsNone(items['stale']['priceDivine'])

    async def test_cache_etag_and_duplicate_keys(self):
        body = {'league': 'Test', 'items': [{'key': 'x', 'id': 'u1', 'kind': 'unique'}] * 2}
        first = await self.client.post('/api/overlay/prices', json=body)
        self.assertEqual(len(first.json()['items']), 1)
        with patch.object(app, 'connect', side_effect=AssertionError('cache must not read DB')):
            second = await self.client.post('/api/overlay/prices', json=body,
                                           headers={'If-None-Match': first.headers['etag']})
        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.content, b'')
        self.assertIn('serialize;dur=', first.headers['server-timing'])

    async def test_stale_exchange_rate_is_not_used(self):
        with app.connect() as db:
            db.execute("UPDATE markets SET observed_at=? WHERE id='exchange:Currency:exalted'", (self.now - 1801,))
        db.close()
        response = await self.client.post('/api/overlay/prices', json={
            'league': 'Test', 'items': [{'key': 'x', 'id': 'u1', 'kind': 'unique'}]})
        self.assertIsNone(response.json()['items']['x']['priceExalted'])
        self.assertEqual(response.json()['rates']['state'], 'stale')

    async def test_empty_markets_returns_without_waiting_for_collection(self):
        with patch.object(app, 'schedule_collection') as schedule:
            response = await self.client.get('/api/markets?league=TestEmpty')
            self.assertEqual(response.status_code, 400)
            app.collector.get_leagues.return_value.append({'id': 'TestEmpty'})
            response = await self.client.get('/api/markets?league=TestEmpty')
            self.assertEqual(response.json()['state'], 'collecting')
            schedule.assert_called_once_with('TestEmpty')

    async def test_last_valid_leagues_are_returned_during_refresh(self):
        collector = app.Collector()
        collector.leagues = [{'id': 'Cached'}]
        with patch.object(app, 'schedule_league_refresh') as schedule:
            self.assertEqual(await collector.get_leagues(), [{'id': 'Cached'}])
            schedule.assert_called_once()
        await collector.close()

    async def test_tablet_variants_are_saved_and_require_exact_selection(self):
        payload = {'core': {'primary': 'divine'}, 'lines': [
            {'id': 1, 'name': '서판', 'baseType': '서판', 'variant': 'Rare', 'primaryValue': 2,
             'listingCount': 123, 'corrupted': False, 'detailsId': 'tablet-rare'},
            {'id': 2, 'name': '서판', 'baseType': '서판', 'variant': 'Normal', 'primaryValue': .1}]}
        app.save_markets('Test', app.normalize('PrecursorTablets', payload))
        response = await self.client.post('/api/overlay/prices', json={'league': 'Test', 'items': [
            {'key': 'ambiguous', 'name': '서판', 'kind': 'tablet'},
            {'key': 'rare', 'name': '서판', 'kind': 'tablet', 'variant': 'Rare'},
            {'key': 'normal', 'name': '서판', 'kind': 'tablet', 'variant': 'Normal'}]})
        items = response.json()['items']
        self.assertEqual(items['ambiguous']['state'], 'missing')
        self.assertEqual(items['rare']['priceExalted'], 200)
        self.assertEqual(items['normal']['priceExalted'], 10)
        self.assertEqual(items['rare']['sampleCount'], 123)
        markets = (await self.client.get('/api/markets?league=Test')).json()['markets']
        rare = next(row for row in markets if row['id'] == 'stash:PrecursorTablets:1:Rare:0')
        self.assertEqual(rare['variant'], 'Rare')
        self.assertEqual(rare['details_id'], 'tablet-rare')
        app.save_markets('Test', app.normalize('PrecursorTablets', {'lines': payload['lines'][1:]}))
        with app.connect() as db:
            count = db.execute("SELECT COUNT(*) FROM market_metadata WHERE market_id='stash:PrecursorTablets:1:Rare:0'").fetchone()[0]
        db.close()
        self.assertEqual(count, 0)
