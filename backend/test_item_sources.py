import gc
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from item_sources import InspectItem, inspect_item, save_catalog, combined_catalog


class ItemSourceTests(unittest.TestCase):
    def test_rare_name_and_modifiers_are_separate(self):
        item = inspect_item(InspectItem(league='Forbidden Rites', text=
            '아이템 종류: 장갑\r\n희귀도: 희귀\r\n슬픔의 발\r\n사이렌 장갑\r\n--------\r\n에너지 보호막: 120\r\n--------\r\n아이템 레벨: 80\r\n--------\r\n최대 생명력 +100\r\n화염 저항 +30%'))
        self.assertEqual(item['name'], '슬픔의 발')
        self.assertEqual(item['baseType'], '사이렌 장갑')
        self.assertEqual(item['modifierCandidates'], ['최대 생명력 +100', '화염 저항 +30%'])
        self.assertEqual(item['state'], 'manual_comparison')
        self.assertIn('Forbidden%20Rites', item['tradeUrl'])
        with self.assertRaises(ValueError):
            inspect_item(InspectItem(league='Test', text='사이렌 장갑'))

    def test_scout_matches_keep_source_and_stale_prices_are_excluded(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, 'DB_PATH', Path(directory) / 'test.sqlite3'):
            app.init_db()
            app.save_markets('Test', [('exchange:Currency:exalted', 'Currency', '화폐', 'Exalted Orb', None,
                                       None, .01, None, None, None, 'exchange', int(time.time()))])
            items = [dict(ItemId=1, CategoryApiId='currency', Text='Exalted Orb', ApiId='exalted', CurrentPrice=1),
                     dict(ItemId=2, CategoryApiId='waystones', Text='Waystone Tier 15', ApiId='waystone-15', CurrentPrice=5)]
            histories = {'ItemHistories': [dict(ItemId=1, History=[dict(Price=1, Time='2020-01-01T00:00:00Z')])]}
            save_catalog(app.connect, 'Test', items, histories, {'BaseCurrencyApiId': 'exalted'}, lambda value: value)
            result = combined_catalog(app.connect, 'Test')
            self.assertEqual(result['counts'], dict(ninja=1, scout=2, scoutUnmatched=1))
            self.assertEqual(result['scout'][0]['state'], 'stale')
            self.assertIsNone(result['scout'][0]['priceExalted'])
            self.assertEqual(result['scoutAdditional'][0]['state'], 'missing')
            with self.assertRaises(ValueError):
                save_catalog(app.connect, 'Test', [], histories, {}, lambda value: value)
            self.assertEqual(len(combined_catalog(app.connect, 'Test')['scout']), 2)
            gc.collect()
