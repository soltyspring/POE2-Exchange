"""Official GGG hourly exchange feed mapping and retention."""

import gc
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class OfficialExchangeTests(unittest.TestCase):
    def test_completed_hour_volume_is_idempotent_and_kept_by_source(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            hour = 1790658000
            item = app.OFFICIAL_ITEM_IDS["exchange:Currency:divine"]
            pair = {"league": "Forbidden Rites", "market_pair": [item, app.OFFICIAL_EXALTED],
                    "volume_traded": {item: 3223, app.OFFICIAL_EXALTED: 1686935},
                    "lowest_ratio": {item: 1, app.OFFICIAL_EXALTED: 535},
                    "highest_ratio": {item: 1, app.OFFICIAL_EXALTED: 500}}
            payload = {"next_change_id": hour + 3600, "markets": [pair]}
            self.assertEqual(app.save_official_exchange_hour(hour, payload), 1)
            self.assertEqual(app.save_official_exchange_hour(hour, payload), 1)
            summary = app.official_volume_summary("Forbidden Rites", "exchange:Currency:divine", hour)
            self.assertEqual(summary["sample_count"], 1)
            self.assertEqual(summary["total_volume_item"], 3223)
            self.assertEqual(summary["cells"][0]["median_volume_item"], 3223)
            with app.connect() as db:
                row = db.execute("SELECT lowest_exalted_ratio,highest_exalted_ratio FROM official_exchange_volume").fetchone()
                self.assertEqual(tuple(row), (500, 535))
            db.close()
            self.assertEqual(app.official_missing_hours(now=hour + 7200, count=1)[0], hour + 3600)
            gc.collect()

    def test_rejects_incomplete_or_misaligned_hour(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            with self.assertRaises(ValueError):
                app.save_official_exchange_hour(1790658000, {"next_change_id": 1790658000, "markets": []})
            gc.collect()


if __name__ == "__main__":
    unittest.main()
