"""Exalted Orb charts use contemporaneous Chaos Orb ratios."""

import gc
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app


class ExaltedChaosTests(unittest.IsolatedAsyncioTestCase):
    async def test_chart_uses_historical_pair_and_current_chaos_quote(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            now = int(time.time())
            bucket = now // 900 * 900 - 900
            with app.connect() as db:
                for market_id, current in (("exalted", 0.002), ("chaos", 0.12)):
                    db.execute("""INSERT INTO markets VALUES
                        ('Test',?,'Currency','화폐',?,NULL,NULL,?,NULL,NULL,NULL,'exchange',?,?)""",
                        (f"exchange:Currency:{market_id}", market_id, current, now, now))
                    db.execute("INSERT INTO market_keys (league,market_id) VALUES ('Test',?)",
                               (f"exchange:Currency:{market_id}",))
                for market_id, historical in (("exalted", 0.002), ("chaos", 0.1)):
                    db.execute("""INSERT INTO market_snapshots VALUES
                        ((SELECT id FROM market_keys WHERE league='Test' AND market_id=?),?,?,?,?)""",
                        (f"exchange:Currency:{market_id}", bucket, historical, None, bucket))
            db.close()
            with patch.object(app.collector, "refresh_market", AsyncMock(return_value={})), \
                 patch.object(app.collector, "get_live_market_quote", AsyncMock(return_value=None)):
                result = await app.candles("exchange:Currency:exalted", "Test", "1m", "chaos", 500)
            self.assertEqual(result["unit"], "chaos")
            self.assertAlmostEqual(result["candles"][0]["close"], 0.02)
            self.assertAlmostEqual(result["candles"][-1]["close"], 0.002 / 0.12)
            self.assertEqual(app.seasonality("Test", "exchange:Currency:exalted", 7, "chaos")["sample_count"], 1)
            gc.collect()


if __name__ == "__main__":
    unittest.main()
