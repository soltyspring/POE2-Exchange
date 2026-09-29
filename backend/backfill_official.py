"""Fetch recent completed GGG Currency Exchange hours into the local database."""

import argparse
import asyncio
import logging

import app


async def main(hours: int, pause: float):
    app.init_db()
    completed = 0
    try:
        for hour_start in app.official_missing_hours(count=hours):
            mapped = await app.fetch_official_exchange_hour(hour_start)
            logging.info("hour=%s mapped_pairs=%s", hour_start, mapped)
            completed += 1
            await asyncio.sleep(pause)
    finally:
        await app.collector.close()
    return completed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--pause", type=float, default=2.0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print({"completed_hours": asyncio.run(main(min(max(args.hours, 1), 168), max(args.pause, 1)))})
