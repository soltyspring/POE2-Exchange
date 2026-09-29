"""Read-only cross-source audit of current POE2 market prices."""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from datetime import datetime, timezone
import re
from urllib.parse import quote

import httpx

import app


def deviation_percent(actual: float, reference: float) -> float:
    return abs(actual - reference) / reference * 100 if reference > 0 else float("inf")


def summary(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "median_percent": round(statistics.median(ordered), 3) if ordered else None,
        "p90_percent": round(ordered[min(len(ordered) - 1, int(len(ordered) * .9))], 3) if ordered else None,
        "max_percent": round(ordered[-1], 3) if ordered else None,
    }


def item_key(name: str | None, base_type: str | None = None) -> str:
    return re.sub(r"[^a-z0-9]", "", f"{name or ''}{base_type or ''}".lower())


async def audit(league: str, scout_limit: int = 60) -> dict:
    app.init_db()
    now = int(time.time())
    headers = {"User-Agent": app.USER_AGENT, "Cache-Control": "no-cache"}
    timeout = httpx.Timeout(45)
    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        # Source-integrity check: fetch every poe.ninja category and run the same
        # normalization code used by the collector before comparing with SQLite.
        scout_items = await app.collector.get_scout_items(league)
        source_rows = {}
        source_errors = {}

        async def fetch_category(category: str):
            path = "exchange/current/overview" if category in app.EXCHANGE_TYPES else "stash/current/item/overview"
            url = f"{app.BASE}/{path}?league={quote(league)}&type={quote(category)}"
            try:
                response = await client.get(url)
                response.raise_for_status()
                return category, app.normalize(category, response.json(), scout_items), None
            except Exception as exc:  # audit should report partial source failures
                return category, [], str(exc)

        fetched = await asyncio.gather(*(fetch_category(category) for category in app.CATEGORIES))
        for category, rows, error in fetched:
            if error:
                source_errors[category] = error
            for row in rows:
                source_rows[row[0]] = row

        with app.connect() as db:
            db_rows = {row["id"]: dict(row) for row in db.execute(
                "SELECT * FROM markets WHERE league=?", (league,))}
            exalted = db_rows.get("exchange:Currency:exalted")
            latest_official = [dict(row) for row in db.execute("""
                SELECT v.* FROM official_exchange_volume v
                JOIN (SELECT league,market_id,MAX(hour_start) latest
                      FROM official_exchange_volume WHERE league=? GROUP BY league,market_id) x
                  ON x.league=v.league AND x.market_id=v.market_id AND x.latest=v.hour_start
                WHERE v.league=?""", (league, league))]

        integrity_diffs = []
        for market_id in sorted(set(source_rows) & set(db_rows)):
            source_price = float(source_rows[market_id][6])
            db_price = float(db_rows[market_id]["price_divine"])
            diff = deviation_percent(db_price, source_price)
            if diff > .01:
                integrity_diffs.append({"id": market_id, "name": db_rows[market_id]["name"],
                                        "db_divine": db_price, "source_divine": source_price,
                                        "difference_percent": round(diff, 3),
                                        "db_age_seconds": now - db_rows[market_id]["observed_at"]})

        # Independent current-price comparison for currency items in POE2Scout.
        currency = [row for row in db_rows.values() if row["category"] == "Currency" and row["id"].startswith("exchange:")]
        semaphore = asyncio.Semaphore(6)

        async def scout_price(row: dict):
            api_id = row["id"].rsplit(":", 1)[-1]
            async with semaphore:
                try:
                    response = await client.get(
                        f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}/Currencies/{quote(api_id, safe='')}")
                    if response.status_code == 404:
                        return None
                    response.raise_for_status()
                    payload = response.json()
                    price = payload.get("CurrentPrice")
                    if not app.finite_positive(price):
                        return None
                    latest_log = next((item for item in payload.get("PriceLogs", [])
                                       if item and app.finite_positive(item.get("Price"))), None)
                    sample_at = None
                    quantity = None
                    if latest_log:
                        quantity = latest_log.get("Quantity")
                        try:
                            stamp = str(latest_log["Time"]).split(".", 1)[0].rstrip("Z")
                            sample_at = int(datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S")
                                            .replace(tzinfo=timezone.utc).timestamp())
                        except (KeyError, TypeError, ValueError):
                            pass
                    local = row["price_divine"] / exalted["price_divine"]
                    return {"id": row["id"], "name": row["name"], "db_exalted": local,
                            "scout_exalted": float(price),
                            "difference_percent": deviation_percent(local, float(price)),
                            "scout_sample_at": sample_at,
                            "scout_age_hours": round((now - sample_at) / 3600, 2) if sample_at else None,
                            "scout_quantity": quantity, "ninja_volume_divine": row["volume_divine"]}
                except Exception:
                    return None

        scout_results = [result for result in await asyncio.gather(
            *(scout_price(row) for row in currency[:scout_limit])) if result]
        scout_results.sort(key=lambda row: row["difference_percent"], reverse=True)

        # POE2Scout also exposes current unique-item estimates. Match by the
        # English metadata keys already retained in the Scout item catalogue.
        unique_results = []
        try:
            response = await client.get(
                f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}/Items")
            response.raise_for_status()
            scout_uniques = {}
            for item in response.json():
                if item.get("CategoryApiId") == "currency" or not app.finite_positive(item.get("CurrentPrice")):
                    continue
                for key in {item_key(item.get("Name"), item.get("Type")), item_key(item.get("Text"))}:
                    if key:
                        scout_uniques.setdefault(key, item)
                icon_filename = (item.get("IconUrl") or "").rsplit("/", 1)[-1].split(".", 1)[0]
                if icon_filename:
                    scout_uniques.setdefault(item_key(icon_filename), item)
            for market in db_rows.values():
                if market["source_kind"] != "stash":
                    continue
                # Korean display names cannot be reliably reverse-translated;
                # match the source icon filename, which both APIs inherit from GGG.
                icon = market.get("icon") or ""
                filename = icon.rsplit("/", 1)[-1].split(".", 1)[0]
                item = scout_uniques.get(item_key(filename))
                if not item:
                    continue
                current = market["price_divine"] / exalted["price_divine"]
                reference = float(item["CurrentPrice"])
                unique_results.append({"id": market["id"], "name": market["name"],
                                       "db_exalted": current, "scout_exalted": reference,
                                       "difference_percent": deviation_percent(current, reference),
                                       "listing_count": market["listing_count"]})
            unique_results.sort(key=lambda row: row["difference_percent"], reverse=True)
        except Exception:
            unique_results = []

        official_results = []
        for row in latest_official:
            market = db_rows.get(row["market_id"])
            if not market or not exalted or not row["lowest_exalted_ratio"] or not row["highest_exalted_ratio"]:
                continue
            current = market["price_divine"] / exalted["price_divine"]
            low, high = sorted((row["lowest_exalted_ratio"], row["highest_exalted_ratio"]))
            outside = 0 if low <= current <= high else min(abs(current - low), abs(current - high)) / max(low, 1e-12) * 100
            official_results.append({"id": row["market_id"], "name": market["name"],
                                     "db_exalted": round(current, 6), "official_hour": row["hour_start"],
                                     "official_low": low, "official_high": high,
                                     "outside_range_percent": round(outside, 3),
                                     "volume_item": row["volume_item"]})

    return {
        "league": league, "audited_at": now,
        "database": {"items": len(db_rows), "newest_age_seconds": now - max(row["observed_at"] for row in db_rows.values())},
        "poe_ninja_integrity": {
            "source_items": len(source_rows), "matched_items": len(set(source_rows) & set(db_rows)),
            "missing_in_db": len(set(source_rows) - set(db_rows)),
            "stale_or_different_over_0_01_percent": len(integrity_diffs),
            "source_errors": source_errors, "largest_differences": sorted(
                integrity_diffs, key=lambda row: row["difference_percent"], reverse=True)[:20]},
        "poe2scout_crosscheck": {
            **summary([row["difference_percent"] for row in scout_results]),
            "within_5_percent": sum(row["difference_percent"] <= 5 for row in scout_results),
            "within_15_percent": sum(row["difference_percent"] <= 15 for row in scout_results),
            "largest_differences": [{**row, "difference_percent": round(row["difference_percent"], 3)}
                                    for row in scout_results[:20]]},
        "poe2scout_unique_crosscheck": {
            **summary([row["difference_percent"] for row in unique_results]),
            "within_15_percent": sum(row["difference_percent"] <= 15 for row in unique_results),
            "largest_differences": [{**row, "difference_percent": round(row["difference_percent"], 3)}
                                    for row in unique_results[:20]]},
        "ggg_completed_hour_crosscheck": official_results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", default="Forbidden Rites")
    parser.add_argument("--scout-limit", type=int, default=60)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(audit(args.league, args.scout_limit)), ensure_ascii=False, indent=2))
