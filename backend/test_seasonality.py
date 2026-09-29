"""Market-wide history and local-time buying-window checks."""

import gc
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import app


class SeasonalityTests(unittest.TestCase):
    def test_full_market_snapshot_is_idempotent_and_requires_fresh_source(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            now = int(time.time())
            with app.connect() as db:
                db.execute("""INSERT INTO markets VALUES
                    ('Test','exchange:Currency:exalted','Currency','화폐','엑잘티드 오브',NULL,
                     NULL,0.002,NULL,NULL,NULL,'exchange',?,?)""", (now, now))
                db.execute("""INSERT INTO markets VALUES
                    ('Test','exchange:Currency:divine','Currency','화폐','신성한 오브',NULL,
                     NULL,1,NULL,NULL,NULL,'exchange',?,?)""", (now, now))
                db.execute("""INSERT INTO fetch_state
                    (league,category,fetched_at,attempted_at) VALUES ('Test','Currency',?,?)""", (now, now))
            db.close()
            app.sample_market_snapshots("Test", now)
            app.sample_market_snapshots("Test", now)
            with app.connect() as db:
                rows = db.execute("SELECT market_id,price_exalted FROM market_snapshots ORDER BY market_id").fetchall()
            db.close()
            self.assertEqual(len(rows), 2)
            prices = {row["market_id"]: row["price_exalted"] for row in rows}
            self.assertAlmostEqual(prices["exchange:Currency:exalted"], 1)
            self.assertAlmostEqual(prices["exchange:Currency:divine"], 500)
            gc.collect()

    def test_korean_weekday_hour_and_minimum_history(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            zone = ZoneInfo("Asia/Seoul")
            today = datetime.now(zone).date()
            start = today - timedelta(days=35)
            with app.connect() as db:
                for offset in range(28):
                    day = start + timedelta(days=offset)
                    for hour in (9, 12, 18):
                        local = datetime(day.year, day.month, day.day, hour, tzinfo=zone)
                        value = 90 if day.weekday() == 0 and hour == 9 else 100
                        db.execute("""INSERT INTO market_snapshots VALUES
                            ('Test','item',?,?,?,?)""", (int(local.timestamp()), value, value, int(local.timestamp())))
            db.close()
            result = app.seasonality("Test", "item", 56, "exalted")
            self.assertEqual(result["best_slot"]["weekday"], 0)
            self.assertEqual(result["best_slot"]["hour"], 9)
            self.assertLess(result["best_slot"]["relative_percent"], 0)
            self.assertEqual(result["best_slot"]["days"], 4)
            gc.collect()


if __name__ == "__main__":
    unittest.main()
