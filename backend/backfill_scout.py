"""Import POE2Scout's historical price observations as a separate source."""

import argparse
from datetime import datetime, timezone
import logging
import time
from urllib.parse import quote

import httpx

from app import EXCHANGE_TYPES, USER_AGENT, connect, init_db

SCOUT_CATEGORIES = {
    "currency": "Currency", "essences": "Essences", "lineagesupportgems": "LineageSupportGems",
    "runes": "Runes", "soulcores": "SoulCores", "ritual": "Ritual", "breach": "Breach",
    "delirium": "Delirium", "fragments": "Fragments", "abyss": "Abyss", "uncutgems": "UncutGems",
    "idol": "Idols", "expedition": "Expedition", "verisium": "Verisium",
}


def import_history(league: str, limit: int = 1000, pause: float = 1.0):
    init_db()
    root = f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}"
    counts = {"items": 0, "logs": 0, "invalid": 0, "skipped": 0}
    with httpx.Client(timeout=40, headers={"User-Agent": USER_AGENT}) as client:
        response = client.get(f"{root}/Items")
        response.raise_for_status()
        items = [item for item in response.json()
                 if item.get("ApiId") and item.get("CategoryApiId") in SCOUT_CATEGORIES]
        with connect() as db:
            for item in items:
                api_id = str(item["ApiId"])
                category = SCOUT_CATEGORIES[str(item["CategoryApiId"])]
                if category not in EXCHANGE_TYPES:
                    counts["skipped"] += 1
                    continue
                market_id = f"exchange:{category}:{api_id}"
                exists = db.execute("SELECT 1 FROM markets WHERE league=? AND id=?", (league, market_id)).fetchone()
                if not exists:
                    counts["skipped"] += 1
                    continue
                time.sleep(pause)
                try:
                    response = client.get(f"{root}/Items/{item['ItemId']}/History",
                                          params={"logCount": limit})
                    if response.status_code == 429:
                        retry = min(120, int(response.headers.get("Retry-After", "30")))
                        logging.warning("Scout rate limited; waiting %ss", retry)
                        time.sleep(retry)
                        response = client.get(f"{root}/Items/{item['ItemId']}/History",
                                              params={"logCount": limit})
                    response.raise_for_status()
                    payload = response.json()
                    logs = payload["PriceHistory"]
                    if not isinstance(logs, list):
                        raise ValueError("PriceHistory is not a list")
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    logging.warning("Skipping %s: %s", api_id, error)
                    counts["skipped"] += 1
                    continue
                db.execute("INSERT OR IGNORE INTO market_keys (league,market_id) VALUES (?,?)",
                           (league, market_id))
                key = db.execute("SELECT id FROM market_keys WHERE league=? AND market_id=?",
                                 (league, market_id)).fetchone()[0]
                fetched_at = int(time.time())
                valid = []
                for log in logs:
                    try:
                        # Scout emits seven fractional digits; Python 3.10's
                        # ISO parser accepts at most six on the Ubuntu host.
                        sample_at = int(datetime.strptime(
                            log["Time"].split(".", 1)[0].rstrip("Z"),
                            "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
                        price = float(log["Price"])
                        if not (0 < price < 1_000_000 and 0 < sample_at <= fetched_at + 3600):
                            raise ValueError("price or timestamp outside expected range")
                        valid.append((key, "poe2scout", sample_at, price, fetched_at))
                    except (KeyError, TypeError, ValueError, OverflowError):
                        counts["invalid"] += 1
                db.executemany("""INSERT INTO external_price_history
                    (market_key,source,sample_at,price_exalted,fetched_at) VALUES (?,?,?,?,?)
                    ON CONFLICT(market_key,source,sample_at) DO UPDATE SET
                    price_exalted=excluded.price_exalted,fetched_at=excluded.fetched_at""", valid)
                db.commit()
                counts["items"] += 1
                counts["logs"] += len(valid)
                logging.info("%s: %s historical price observations", api_id, len(valid))
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", default="Forbidden Rites")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--pause", type=float, default=1.0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print(import_history(args.league, min(max(args.limit, 1), 2000), max(args.pause, 0.5)))
