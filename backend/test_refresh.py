"""Checks for cache revalidation and rate-limit behavior."""

import gc
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

import app


class RefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_refresh_revalidates_and_force_skips_conditional_cache(self):
        headers = []
        payload = {"core": {"primary": "divine", "items": [{"id": "divine", "name": "Divine Orb"}]},
                   "lines": [{"id": "divine", "primaryValue": 1.0}]}

        def respond(request):
            headers.append(dict(request.headers))
            if len(headers) == 2:
                return httpx.Response(304)
            return httpx.Response(200, headers={"ETag": '"version-1"'}, json=payload)

        with tempfile.TemporaryDirectory() as directory, patch.object(app, "DB_PATH", Path(directory) / "prices.sqlite3"):
            app.init_db()
            collector = app.Collector()
            await collector.client.aclose()
            collector.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
            collector.get_scout_items = AsyncMock(return_value={})
            try:
                first = await collector.refresh("Test", {"Currency"}, force=True)
                second = await collector.refresh("Test", {"Currency"}, min_interval=0)
                third = await collector.refresh("Test", {"Currency"}, force=True)
                self.assertEqual(first["refreshed"], ["Currency"])
                self.assertEqual(second["refreshed"], ["Currency"])
                self.assertEqual(third["refreshed"], ["Currency"])
                self.assertNotIn("if-none-match", headers[0])
                self.assertEqual(headers[1]["if-none-match"], '"version-1"')
                self.assertNotIn("if-none-match", headers[2])
                self.assertEqual(headers[2]["cache-control"], "no-cache")
            finally:
                await collector.close()
            gc.collect()

    async def test_retry_after_blocks_host_without_a_second_request(self):
        calls = 0

        def respond(_request):
            nonlocal calls
            calls += 1
            return httpx.Response(429, headers={"Retry-After": "120"})

        collector = app.Collector()
        await collector.client.aclose()
        collector.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        try:
            response = await collector._get_with_backoff("https://poe.ninja/example")
            self.assertEqual(response.status_code, 429)
            self.assertGreater(collector.host_retry_at["poe.ninja"], time.time() + 110)
            with self.assertRaises(httpx.HTTPError):
                await collector._get_with_backoff("https://poe.ninja/another")
            self.assertEqual(calls, 1)
        finally:
            await collector.close()

    def test_status_uses_selected_cadence_and_respects_cooldown(self):
        row = {"category": "Currency", "attempted_at": 1000, "fetched_at": 1000,
               "etag": '"v1"', "last_modified": None, "error": None}
        status = app.source_status_view(row, 60, 1020, 1100)
        self.assertEqual(status["next_refresh_at"], 1100)
        self.assertEqual(status["cache_state"], "fresh")
        self.assertTrue(status["conditional_cache"])


if __name__ == "__main__":
    unittest.main()
