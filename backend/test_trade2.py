"""Local contract checks for the optional, unsupported listing source."""

import gc
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import app


class Trade2ContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_exchange_ratio_uses_only_the_requested_currency_pair(self):
        calls = 0

        def respond(request):
            nonlocal calls
            calls += 1
            self.assertEqual(request.method, "POST")
            return httpx.Response(200, json={"result": {
                "a": {"listing": {"offers": [{"exchange": {"currency": "divine", "amount": 1},
                                              "item": {"currency": "exalted", "amount": 500}}]}},
                "b": {"listing": {"offers": [{"exchange": {"currency": "divine", "amount": 2},
                                              "item": {"currency": "exalted", "amount": 1000}}]}},
                "bad": {"listing": {"offers": [{"exchange": {"currency": "chaos", "amount": 1},
                                                "item": {"currency": "exalted", "amount": 999999}}]}},
            }})

        with patch.object(app, "TRADE2_LIVE_ENABLED", True):
            collector = app.Collector()
            await collector.client.aclose()
            collector.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
            try:
                quote = await collector.get_trade2_exchange("Test", "divine", "exalted")
                self.assertEqual(quote["median"], 500)
                self.assertEqual(quote["count"], 2)
                await collector.get_trade2_exchange("Test", "divine", "exalted")
                self.assertEqual(calls, 1)
            finally:
                await collector.close()

    async def test_rate_limit_stops_retries_and_keeps_last_quote_out_of_current_view(self):
        calls = 0

        def respond(_request):
            nonlocal calls
            calls += 1
            return httpx.Response(429, headers={"Retry-After": "120"})

        with patch.object(app, "TRADE2_LIVE_ENABLED", True):
            collector = app.Collector()
            await collector.client.aclose()
            collector.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
            try:
                self.assertIsNone(await collector.get_trade2_exchange("Test", "divine", "exalted"))
                self.assertIsNone(await collector.get_trade2_exchange("Test", "divine", "exalted"))
                self.assertEqual(calls, 1)
            finally:
                await collector.close()

    def test_live_observation_is_stored_in_a_separate_series(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            app.save_live_observation("Test", "exchange:Currency:divine",
                                      {"price_divine": 1.0, "price_exalted": 500.0})
            with app.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM live_observations").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 0)
            db.close()
            del db
            gc.collect()


if __name__ == "__main__":
    unittest.main()
