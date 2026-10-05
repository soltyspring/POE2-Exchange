"""Local PoE2 economy snapshot service with optional live trade-site quotes for major currencies."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import logging
import os
import re
import sqlite3
import statistics
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from overlay_prices import OverlayRequest, SnapshotStore, overlay_response
from item_sources import InspectItem, inspect_item, init_source_tables, save_catalog, combined_catalog
from build_import import router as build_router

BASE = "https://poe.ninja/poe2/api/economy"
EXCHANGE_TYPES = {
    "Currency": "화폐", "Essences": "에센스", "LineageSupportGems": "혈통 보조젬",
    "Runes": "룬", "SoulCores": "영혼핵", "Ritual": "징조",
    "Breach": "촉매", "Delirium": "액상 감정", "Fragments": "조각",
    "Abyss": "심연", "UncutGems": "미가공 젬", "Idols": "우상",
    "Expedition": "탐험", "Verisium": "베리시움",
}
STASH_TYPES = {
    "UniqueWeapons": "고유 무기", "UniqueArmours": "고유 방어구",
    "UniqueAccessories": "고유 장신구", "UniqueFlasks": "고유 플라스크",
    "UniqueJewels": "고유 주얼", "UniqueCharms": "고유 부적",
    "UniqueSanctumRelics": "고유 유물", "UniqueTablets": "고유 서판",
    "PrecursorTablets": "선대 서판",
}
CATEGORIES = {**EXCHANGE_TYPES, **STASH_TYPES}
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("POE_DB_PATH", str(ROOT / "data" / "prices.sqlite3")))
AI_API_KEY = os.getenv("CLAUDE_API_KEY", "").strip()
AI_API_URL = os.getenv("CLAUDE_API_URL", "https://api.anthropic.com/v1/messages").strip()
AI_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001").strip()
AI_SUMMARY_CACHE: dict[str, tuple[float, dict]] = {}
AI_SUMMARY_TTL = 3600
USER_AGENT = os.getenv(
    "POE_NINJA_USER_AGENT", "Poe2MinuteChart/0.1 (personal local dashboard; contact: local operator)"
)
MARKET_POLL_SECONDS = max(300, int(os.getenv("POE_MARKET_POLL_SECONDS", "900")))
SELECTED_POLL_SECONDS = max(60, int(os.getenv("POE_SELECTED_POLL_SECONDS", "300")))
SCOUT_POLL_SECONDS = max(60, int(os.getenv("POE_SCOUT_POLL_SECONDS", "300")))
LEAGUE_CACHE_SECONDS = max(1800, int(os.getenv("POE_LEAGUE_CACHE_SECONDS", "3600")))
HTTP_MIN_GAP_SECONDS = max(.1, float(os.getenv("POE_HTTP_MIN_GAP_SECONDS", ".5")))
TRADE2_LIVE_ENABLED = os.getenv("POE_TRADE2_LIVE", "0").lower() in {"1", "true", "on", "yes"}
TRADE2_LIVE_SECONDS = max(15, int(os.getenv("POE_TRADE2_LIVE_SECONDS", "30")))
TRADE2_MIN_GAP_SECONDS = max(2.0, float(os.getenv("POE_TRADE2_MIN_GAP_SECONDS", "3")))
TRADE2_BASE = "https://www.pathofexile.com"
TRADE2_MAJOR_IDS = {"exalted", "chaos", "divine", "annul"}
HISTORY_SNAPSHOT_SECONDS = max(300, int(os.getenv("POE_HISTORY_SNAPSHOT_SECONDS", "900")))
TRACKED_ACTIVE_SECONDS = max(3600, int(os.getenv("POE_TRACKED_ACTIVE_SECONDS", "86400")))
OFFICIAL_EXCHANGE_BASE = "https://web.poecdn.com/api/currency-exchange/poe2"
OFFICIAL_BACKFILL_DAYS = max(1, min(84, int(os.getenv("POE_OFFICIAL_BACKFILL_DAYS", "28"))))
OFFICIAL_EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare"
OFFICIAL_ITEM_IDS = {
    "exchange:Currency:divine": "Metadata/Items/Currency/CurrencyModValues",
    "exchange:Currency:chaos": "Metadata/Items/Currency/CurrencyRerollRare",
    "exchange:Currency:annul": "Metadata/Items/Currency/CurrencyRemoveMod",
}
SEOUL = ZoneInfo("Asia/Seoul")
MAX_HTTP_RETRIES = 3
LOCALIZATION_VERSION = "v2026.09.17.2"
LOCALIZATION_FILES = {
    "item_names_kr.json":
        f"https://cdn.jsdelivr.net/gh/seominugi/poe-game-data@{LOCALIZATION_VERSION}/poe2/names/kr.json",
    "unique_names_kr.json":
        f"https://cdn.jsdelivr.net/gh/seominugi/poe-game-data@{LOCALIZATION_VERSION}/poe2/uniques/json/uniques.json",
    "poe2db_names_kr.json":
        "https://cdn.poe2db.tw/json/autocompletecb_kr.b6f7982de7b02190.json",
}
LOCALIZATION_DIR = ROOT / "data"
ICON_CACHE_DIR = ROOT / "data" / "icon_cache"
KOREAN_NAMES: dict[str, str] = {}
LOGGER = logging.getLogger(__name__)
overlay_snapshots = SnapshotStore()
collection_tasks: dict[str, asyncio.Task] = {}


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def name_variants(value: str):
    decoded = unquote(value).replace("_", " ").replace("-", " ")
    normalized = normalize_name(decoded)
    yield normalized
    if "'" in normalized:
        yield normalized.replace("'", "")


def load_korean_names():
    """Load the game's Korean display names, refreshing the local cache when absent."""
    global KOREAN_NAMES
    names: dict[str, str] = {}
    LOCALIZATION_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        for filename, url in LOCALIZATION_FILES.items():
            path = LOCALIZATION_DIR / filename
            try:
                if not path.exists() or path.stat().st_size == 0:
                    response = client.get(url)
                    response.raise_for_status()
                    path.write_text(response.text, encoding="utf-8")
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, httpx.HTTPError):
                continue
            if isinstance(payload, dict):
                for key, value in payload.items():
                    if value:
                        for variant in name_variants(str(key)):
                            names[variant] = str(value)
            elif isinstance(payload, list):
                for item in payload:
                    if not isinstance(item, dict):
                        continue
                    item_name = item.get("name")
                    if isinstance(item_name, dict) and item_name.get("en") and item_name.get("kr"):
                        for variant in name_variants(item_name["en"]):
                            names[variant] = item_name["kr"]
                    elif item.get("value") and item.get("label"):
                        for variant in name_variants(item["value"]):
                            names[variant] = str(item["label"])
    # A few new uniques are already visible in the current economy feed but are
    # newer than the checked-in GGPK snapshot. Their Korean PoE2DB names are
    # kept as a small compatibility bridge until the next game-data snapshot.
    names.update({
        "bluetongue": "푸른혀",
        "redbeak": "붉은 부리",
        "winter's bite": "겨울의 추위",
        "winters bite": "겨울의 추위",
        "the master's reach": "대가의 깜냥",
        "the masters reach": "대가의 깜냥",
    })
    KOREAN_NAMES = names
    translate_existing_markets()


def korean_name(value: str | None) -> str | None:
    if not value:
        return value
    for variant in name_variants(value):
        if variant in KOREAN_NAMES:
            return KOREAN_NAMES[variant]
    return value


def init_db():
    with connect() as db:
        init_source_tables(db)
        db.executescript("""
        CREATE TABLE IF NOT EXISTS markets (
          league TEXT NOT NULL, id TEXT NOT NULL, category TEXT NOT NULL,
          category_label TEXT NOT NULL, name TEXT NOT NULL, icon TEXT,
          base_type TEXT, price_divine REAL NOT NULL, volume_divine REAL,
          listing_count INTEGER, trend_percent REAL, source_kind TEXT NOT NULL,
          observed_at INTEGER NOT NULL, changed_at INTEGER NOT NULL,
          PRIMARY KEY (league, id)
        );
        CREATE TABLE IF NOT EXISTS market_metadata (
          league TEXT NOT NULL, market_id TEXT NOT NULL,
          variant TEXT, details_id TEXT, item_level INTEGER, corrupted INTEGER,
          PRIMARY KEY (league, market_id)
        );
        CREATE TABLE IF NOT EXISTS observations (
          league TEXT NOT NULL, market_id TEXT NOT NULL, minute INTEGER NOT NULL,
          price_divine REAL NOT NULL, price_exalted REAL, price_chaos REAL,
          PRIMARY KEY (league, market_id, minute)
        );
        CREATE TABLE IF NOT EXISTS market_keys (
          id INTEGER PRIMARY KEY, league TEXT NOT NULL, market_id TEXT NOT NULL,
          UNIQUE (league, market_id)
        );
        CREATE TABLE IF NOT EXISTS market_snapshots (
          market_key INTEGER NOT NULL, bucket_start INTEGER NOT NULL,
          price_divine REAL NOT NULL, price_exalted REAL,
          source_checked_at INTEGER NOT NULL,
          PRIMARY KEY (market_key, bucket_start)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS external_price_history (
          market_key INTEGER NOT NULL, source TEXT NOT NULL, sample_at INTEGER NOT NULL,
          price_exalted REAL NOT NULL, fetched_at INTEGER NOT NULL,
          PRIMARY KEY (market_key, source, sample_at)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS official_exchange_hours (
          hour_start INTEGER PRIMARY KEY, fetched_at INTEGER NOT NULL,
          pair_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS official_exchange_volume (
          league TEXT NOT NULL, market_id TEXT NOT NULL, hour_start INTEGER NOT NULL,
          volume_item INTEGER NOT NULL, volume_exalted INTEGER NOT NULL,
          lowest_exalted_ratio REAL, highest_exalted_ratio REAL,
          PRIMARY KEY (league, market_id, hour_start)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS live_observations (
          league TEXT NOT NULL, market_id TEXT NOT NULL, minute INTEGER NOT NULL,
          price_divine REAL, price_exalted REAL NOT NULL,
          PRIMARY KEY (league, market_id, minute)
        );
        CREATE INDEX IF NOT EXISTS live_observations_lookup
          ON live_observations (league, market_id, minute);
        CREATE INDEX IF NOT EXISTS observations_lookup
          ON observations (league, market_id, minute);
        CREATE TABLE IF NOT EXISTS tracked (
          league TEXT NOT NULL, market_id TEXT NOT NULL, last_viewed INTEGER NOT NULL,
          PRIMARY KEY (league, market_id)
        );
        CREATE TABLE IF NOT EXISTS fetch_state (
          league TEXT NOT NULL, category TEXT NOT NULL, etag TEXT,
          last_modified TEXT, fetched_at INTEGER NOT NULL DEFAULT 0,
          attempted_at INTEGER NOT NULL DEFAULT 0, error TEXT,
          PRIMARY KEY (league, category)
        );
        CREATE TABLE IF NOT EXISTS cache_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL, key TEXT NOT NULL, event TEXT NOT NULL,
          status INTEGER, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS cache_events_lookup
          ON cache_events (source, key, created_at);
        CREATE TABLE IF NOT EXISTS market_display_order (
          league TEXT NOT NULL, market_id TEXT NOT NULL, display_order INTEGER NOT NULL,
          PRIMARY KEY (league, market_id)
        );
        """)
        columns = {r["name"] for r in db.execute("PRAGMA table_info(fetch_state)")}
        if "attempted_at" not in columns:
            db.execute("ALTER TABLE fetch_state ADD COLUMN attempted_at INTEGER NOT NULL DEFAULT 0")
        observation_columns = {r["name"] for r in db.execute("PRAGMA table_info(observations)")}
        if "price_exalted" not in observation_columns:
            db.execute("ALTER TABLE observations ADD COLUMN price_exalted REAL")
        if "price_chaos" not in observation_columns:
            db.execute("ALTER TABLE observations ADD COLUMN price_chaos REAL")
        snapshot_columns = {r["name"] for r in db.execute("PRAGMA table_info(market_snapshots)")}
        if "league" in snapshot_columns:
            db.execute("ALTER TABLE market_snapshots RENAME TO market_snapshots_legacy")
            db.execute("DROP INDEX IF EXISTS market_snapshots_by_time")
            db.execute("""CREATE TABLE market_snapshots (
                market_key INTEGER NOT NULL, bucket_start INTEGER NOT NULL,
                price_divine REAL NOT NULL, price_exalted REAL,
                source_checked_at INTEGER NOT NULL,
                PRIMARY KEY (market_key, bucket_start)) WITHOUT ROWID""")
            db.execute("""INSERT OR IGNORE INTO market_keys (league, market_id)
                SELECT DISTINCT league, market_id FROM market_snapshots_legacy""")
            db.execute("""INSERT INTO market_snapshots
                SELECT k.id, s.bucket_start, s.price_divine, s.price_exalted, s.source_checked_at
                FROM market_snapshots_legacy s JOIN market_keys k
                  ON k.league=s.league AND k.market_id=s.market_id""")
            db.execute("DROP TABLE market_snapshots_legacy")
        db.execute("CREATE INDEX IF NOT EXISTS market_snapshots_by_time ON market_snapshots (bucket_start)")


def translate_existing_markets():
    if not KOREAN_NAMES or not DB_PATH.exists():
        return
    with connect() as db:
        rows = db.execute("SELECT league, id, name, base_type FROM markets").fetchall()
        for row in rows:
            name = korean_name(row["name"])
            base_type = korean_name(row["base_type"])
            if name != row["name"] or base_type != row["base_type"]:
                db.execute("UPDATE markets SET name=?, base_type=? WHERE league=? AND id=?",
                           (name, base_type, row["league"], row["id"]))


def normalized_icon(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("/"):
        return "https://poe.ninja" + url
    return url if url.startswith("https://") else None


async def cached_market_icon(league: str, market_id: str) -> Path:
    """Fetch a market icon once and serve it from persistent local storage."""
    cache_key = hashlib.sha256(f"{league}\0{market_id}".encode()).hexdigest()
    existing = next(ICON_CACHE_DIR.glob(cache_key + ".*"), None) if ICON_CACHE_DIR.exists() else None
    if existing:
        return existing
    with connect() as db:
        market = db.execute("SELECT icon FROM markets WHERE league=? AND id=?", (league, market_id)).fetchone()
    if market is None:
        raise HTTPException(404, "Market not found")
    icon_url = normalized_icon(market["icon"])
    if not icon_url and market_id.startswith("exchange:"):
        api_id = market_id.rsplit(":", 1)[-1]
        metadata_url = (f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}"
                        f"/Currencies/{quote(api_id, safe='')}")
        try:
            metadata = await collector._get_with_backoff(metadata_url)
            if metadata.status_code == 200:
                icon_url = normalized_icon(metadata.json().get("IconUrl"))
                if icon_url:
                    with connect() as db:
                        db.execute("UPDATE markets SET icon=? WHERE league=? AND id=?",
                                   (icon_url, league, market_id))
        except (httpx.HTTPError, ValueError):
            icon_url = None
    if not icon_url or urlsplit(icon_url).netloc not in {"web.poecdn.com", "poe.ninja"}:
        raise HTTPException(404, "Market icon unavailable")
    response = await collector._get_with_backoff(icon_url)
    if response.status_code != 200 or not response.content:
        raise HTTPException(502, "Market icon source unavailable")
    content_type = response.headers.get("content-type", "").split(";", 1)[0]
    suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
              "image/gif": ".gif", "image/svg+xml": ".svg"}.get(content_type)
    if not suffix:
        raise HTTPException(502, "Unsupported market icon format")
    ICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = ICON_CACHE_DIR / (cache_key + suffix)
    target.write_bytes(response.content)
    return target


def finite_positive(value):
    try:
        number = float(value)
        return number if 0 < number < 1e12 else None
    except (TypeError, ValueError):
        return None


def retry_after_seconds(value: str | None, fallback: float = 60.0) -> float:
    if not value:
        return fallback
    try:
        return max(1.0, float(value))
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(1.0, date.timestamp() - time.time())
        except (TypeError, ValueError, OverflowError):
            return fallback


def source_status_view(row: dict, interval: int, now: int, retry_at: float = 0) -> dict:
    state = dict(row)
    state["next_refresh_at"] = max(state["attempted_at"] + interval, int(retry_at))
    state["cache_age_seconds"] = max(0, now - state["fetched_at"]) if state["fetched_at"] else None
    state["cache_state"] = ("error" if state["error"] else
                            "fresh" if state["fetched_at"] and now < state["next_refresh_at"] else "stale")
    state["conditional_cache"] = bool(state.pop("etag", None) or state.pop("last_modified", None))
    return state


def readable_id(value: str) -> str:
    return value.replace("-", " ").title()


def normalize(category: str, payload: dict, scout_items: dict | None = None):
    core = payload.get("core") or {}
    now = int(time.time())
    if category in EXCHANGE_TYPES:
        ordered_items = [item for item in core.get("items", []) if "id" in item]
        items = {item["id"]: item for item in ordered_items}
        scout_items = scout_items or {}
        rows = []
        for line_order, line in enumerate(payload.get("lines", [])):
            price = finite_positive(line.get("primaryValue"))
            if price is None:
                continue
            item = items.get(line.get("id"), {})
            scout = scout_items.get(line.get("id"), {})
            rows.append((f"exchange:{category}:{line['id']}", category, CATEGORIES[category],
                         korean_name(item.get("name") or scout.get("Text") or readable_id(str(line["id"]))),
                         normalized_icon(item.get("image") or scout.get("IconUrl")),
                         None, price, line.get("volumePrimaryValue"), None,
                         (line.get("sparkline") or {}).get("totalChange"), "exchange", now,
                         line_order))
        if category == "Currency":
            primary = core.get("primary")
            item = items.get(primary, {})
            if primary and not any(r[0] == f"exchange:Currency:{primary}" for r in rows):
                rows.append((f"exchange:Currency:{primary}", category, CATEGORIES[category],
                             korean_name(item.get("name") or primary), normalized_icon(item.get("image")),
                             None, 1.0, None, None, 0.0, "reference", now,
                             len(rows)))
        return rows
    rows = []
    for line in payload.get("lines", []):
        price = finite_positive(line.get("primaryValue"))
        if price is None:
            continue
        market_id = f"stash:{category}:{line.get('id')}:{line.get('variant') or ''}:{int(bool(line.get('corrupted')))}"
        rows.append((market_id, category, CATEGORIES[category], korean_name(line.get("name") or "Unknown"),
                     normalized_icon(line.get("icon")), korean_name(line.get("baseType")), price,
                     None, line.get("listingCount"),
                     (line.get("sparkLine") or {}).get("totalChange"), "stash", now, len(rows),
                     {"variant": line.get("variant"), "details_id": line.get("detailsId"),
                      "item_level": line.get("levelRequired"), "corrupted": int(bool(line.get("corrupted")))}))
    return rows


def save_markets(league: str, rows: list[tuple]):
    with connect() as db:
        category = rows[0][1]
        previous_ids = {item[0] for item in db.execute(
            "SELECT id FROM markets WHERE league=? AND category=?", (league, category))}
        current_ids = {row[0] for row in rows}
        for fallback_order, row in enumerate(rows):
            market_row = row[:12]
            display_order = row[12] if len(row) > 12 else fallback_order
            old = db.execute("SELECT price_divine, changed_at FROM markets WHERE league=? AND id=?",
                             (league, row[0])).fetchone()
            changed_at = market_row[-1] if old is None or old["price_divine"] != row[6] else old["changed_at"]
            db.execute("""INSERT INTO markets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(league,id) DO UPDATE SET
                category=excluded.category, category_label=excluded.category_label,
                name=excluded.name, icon=excluded.icon, base_type=excluded.base_type,
                price_divine=excluded.price_divine, volume_divine=excluded.volume_divine,
                listing_count=excluded.listing_count, trend_percent=excluded.trend_percent,
                source_kind=excluded.source_kind, observed_at=excluded.observed_at,
                changed_at=excluded.changed_at""", (league, *market_row, changed_at))
            db.execute("""INSERT INTO market_display_order VALUES (?,?,?)
                ON CONFLICT(league,market_id) DO UPDATE SET display_order=excluded.display_order""",
                (league, row[0], display_order))
            metadata = row[13] if len(row) > 13 else {}
            db.execute("""INSERT INTO market_metadata VALUES (?,?,?,?,?,?)
                ON CONFLICT(league,market_id) DO UPDATE SET
                variant=excluded.variant,details_id=excluded.details_id,
                item_level=excluded.item_level,corrupted=excluded.corrupted""",
                (league, row[0], metadata.get('variant'), metadata.get('details_id'),
                 metadata.get('item_level'), metadata.get('corrupted')))
        db.executemany("DELETE FROM markets WHERE league=? AND id=?",
                       ((league, stale_id) for stale_id in previous_ids - current_ids))
        db.executemany("DELETE FROM market_display_order WHERE league=? AND market_id=?",
                       ((league, stale_id) for stale_id in previous_ids - current_ids))
        db.executemany("DELETE FROM market_metadata WHERE league=? AND market_id=?",
                       ((league, stale_id) for stale_id in previous_ids - current_ids))
    overlay_snapshots.invalidate(league)


def enrich_exchange_metadata(league: str, scout_items: dict):
    if not scout_items:
        return
    with connect() as db:
        for api_id, item in scout_items.items():
            name = korean_name(item.get("Text"))
            if not name:
                continue
            db.execute("""UPDATE markets SET name=?, icon=COALESCE(?,icon)
                WHERE league=? AND source_kind IN ('exchange','reference')
                  AND id LIKE ?""",
                (name, normalized_icon(item.get("IconUrl")), league, f"exchange:%:{api_id}"))


def sample_prices():
    minute = int(time.time()) // 60 * 60
    with connect() as db:
        db.execute("""INSERT OR IGNORE INTO observations
            (league,market_id,minute,price_divine,price_exalted,price_chaos)
            SELECT m.league,m.id,?,m.price_divine,
              CASE WHEN ex.price_divine > 0 THEN m.price_divine/ex.price_divine ELSE NULL END,
              CASE WHEN chaos.price_divine > 0 THEN m.price_divine/chaos.price_divine ELSE NULL END
            FROM tracked t JOIN markets m ON m.league=t.league AND m.id=t.market_id
            LEFT JOIN markets ex ON ex.league=m.league
              AND ex.id='exchange:Currency:exalted'
            LEFT JOIN markets chaos ON chaos.league=m.league
              AND chaos.id='exchange:Currency:chaos'
            WHERE t.last_viewed >= ?""", (minute, minute - TRACKED_ACTIVE_SECONDS))
        db.execute("DELETE FROM tracked WHERE last_viewed < ?",
                   (minute - TRACKED_ACTIVE_SECONDS,))


def sample_market_snapshots(league: str, now: int | None = None):
    """Persist a market-wide observation after a verified full-market refresh."""
    now = int(time.time()) if now is None else now
    bucket_start = now // HISTORY_SNAPSHOT_SECONDS * HISTORY_SNAPSHOT_SECONDS
    with connect() as db:
        db.execute("""INSERT OR IGNORE INTO market_keys (league, market_id)
            SELECT league, id FROM markets WHERE league=?""", (league,))
        db.execute("""INSERT INTO market_snapshots
            (market_key,bucket_start,price_divine,price_exalted,source_checked_at)
            SELECT k.id,?,m.price_divine,
              CASE WHEN ex.price_divine > 0 THEN m.price_divine/ex.price_divine ELSE NULL END,
              f.fetched_at
            FROM markets m
            JOIN market_keys k ON k.league=m.league AND k.market_id=m.id
            JOIN fetch_state f ON f.league=m.league AND f.category=m.category
            LEFT JOIN markets ex ON ex.league=m.league AND ex.id='exchange:Currency:exalted'
            WHERE m.league=? AND f.error IS NULL AND f.fetched_at >= ?
            ON CONFLICT(market_key,bucket_start) DO UPDATE SET
              price_divine=excluded.price_divine,
              price_exalted=excluded.price_exalted,
              source_checked_at=excluded.source_checked_at
            WHERE excluded.source_checked_at > market_snapshots.source_checked_at""",
            (bucket_start, league, now - MARKET_POLL_SECONDS * 2))


def save_official_exchange_hour(hour_start: int, payload: dict):
    """Keep GGG completed-hour exchange volumes separate from price estimates."""
    if payload.get("next_change_id") != hour_start + 3600 or not isinstance(payload.get("markets"), list):
        raise ValueError("Official exchange response does not match the requested completed hour")
    by_item = {value: key for key, value in OFFICIAL_ITEM_IDS.items()}
    rows = []
    for pair in payload["markets"]:
        if not isinstance(pair, dict):
            continue
        ids = pair.get("market_pair") or []
        if len(ids) != 2 or OFFICIAL_EXALTED not in ids:
            continue
        item_id = ids[0] if ids[1] == OFFICIAL_EXALTED else ids[1]
        market_id = by_item.get(item_id)
        if not market_id or not isinstance(pair.get("league"), str):
            continue
        volumes = pair.get("volume_traded") or {}
        try:
            volume_item = int(volumes[item_id])
            volume_exalted = int(volumes[OFFICIAL_EXALTED])
            if volume_item < 0 or volume_exalted < 0:
                continue
        except (KeyError, TypeError, ValueError):
            continue
        ratios = []
        for field in ("lowest_ratio", "highest_ratio"):
            ratio = pair.get(field) or {}
            try:
                item_amount = float(ratio[item_id])
                exalted_amount = float(ratio[OFFICIAL_EXALTED])
                if item_amount > 0 and exalted_amount > 0:
                    ratios.append(exalted_amount / item_amount)
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                continue
        rows.append((pair["league"], market_id, hour_start, volume_item, volume_exalted,
                     min(ratios) if ratios else None, max(ratios) if ratios else None))
    with connect() as db:
        db.executemany("""INSERT INTO official_exchange_volume
            (league,market_id,hour_start,volume_item,volume_exalted,
             lowest_exalted_ratio,highest_exalted_ratio) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(league,market_id,hour_start) DO UPDATE SET
              volume_item=excluded.volume_item,volume_exalted=excluded.volume_exalted,
              lowest_exalted_ratio=excluded.lowest_exalted_ratio,
              highest_exalted_ratio=excluded.highest_exalted_ratio""", rows)
        db.execute("""INSERT OR REPLACE INTO official_exchange_hours
            (hour_start,fetched_at,pair_count) VALUES (?,?,?)""",
            (hour_start, int(time.time()), len(payload["markets"])))
    return len(rows)


def official_missing_hours(now: int | None = None, count: int = 2):
    now = int(time.time()) if now is None else now
    latest = now // 3600 * 3600 - 3600
    earliest = latest - OFFICIAL_BACKFILL_DAYS * 86400
    with connect() as db:
        fetched = {row[0] for row in db.execute(
            "SELECT hour_start FROM official_exchange_hours WHERE hour_start BETWEEN ? AND ?",
            (earliest, latest))}
    return [hour for hour in range(latest, earliest - 1, -3600) if hour not in fetched][:count]


def official_volume_summary(league: str, market_id: str, since: int):
    supported = market_id in OFFICIAL_ITEM_IDS
    if not supported:
        return {"supported": False, "source": "GGG Currency Exchange", "sample_count": 0,
                "first_hour": None, "last_hour": None, "total_volume_item": 0, "cells": []}
    with connect() as db:
        rows = db.execute("""SELECT hour_start,volume_item FROM official_exchange_volume
            WHERE league=? AND market_id=? AND hour_start>=? ORDER BY hour_start""",
            (league, market_id, since)).fetchall()
    by_slot: dict[tuple[int, int], list[int]] = {}
    for row in rows:
        local = datetime.fromtimestamp(row["hour_start"], SEOUL)
        by_slot.setdefault((local.weekday(), local.hour), []).append(row["volume_item"])
    cells = [{"weekday": weekday, "hour": hour, "median_volume_item": round(statistics.median(values)),
              "hours": len(values)} for (weekday, hour), values in sorted(by_slot.items())]
    return {"supported": True, "source": "GGG Currency Exchange", "sample_count": len(rows),
            "first_hour": rows[0]["hour_start"] if rows else None,
            "last_hour": rows[-1]["hour_start"] if rows else None,
            "total_volume_item": sum(row["volume_item"] for row in rows), "cells": cells}


def currency_chaos_snapshots(db: sqlite3.Connection, league: str, market_id: str, since: int):
    """Historical chaos received for one currency item, using same-bucket snapshots."""
    return db.execute("""SELECT item.bucket_start, item.price_divine/chaos.price_divine AS price
        FROM market_snapshots item
        JOIN market_keys item_key ON item_key.id=item.market_key
        JOIN market_keys chaos_key ON chaos_key.league=item_key.league
          AND chaos_key.market_id='exchange:Currency:chaos'
        JOIN market_snapshots chaos ON chaos.market_key=chaos_key.id
          AND chaos.bucket_start=item.bucket_start
        WHERE item_key.league=? AND item_key.market_id=?
          AND item.bucket_start>=? AND chaos.price_divine>0
        ORDER BY item.bucket_start""", (league, market_id, since)).fetchall()


def seasonality(league: str, market_id: str, days: int, unit: str):
    """Compare each Seoul weekday/hour to that day's median price."""
    column = "price_exalted" if unit == "exalted" else "price_divine"
    since = int(time.time()) - days * 86400
    with connect() as db:
        if unit == "chaos" and market_id in {"exchange:Currency:exalted", "exchange:Currency:divine"}:
            rows = currency_chaos_snapshots(db, league, market_id, since)
        else:
            rows = db.execute(f"""SELECT s.bucket_start, s.{column} AS price FROM market_snapshots s
                JOIN market_keys k ON k.id=s.market_key
                WHERE k.league=? AND k.market_id=? AND s.bucket_start>=? AND s.{column}>0
                ORDER BY bucket_start""", (league, market_id, since)).fetchall()
        source = "poe.ninja"
        own_span_days = ((rows[-1]["bucket_start"] - rows[0]["bucket_start"]) / 86400) if len(rows) > 1 else 0
        if unit == "exalted" and (len(rows) < 100 or own_span_days < 21) and market_id.startswith("exchange:"):
            historical = db.execute("""SELECT h.sample_at AS bucket_start,
                h.price_exalted AS price FROM external_price_history h
                JOIN market_keys k ON k.id=h.market_key
                WHERE k.league=? AND k.market_id=? AND h.source='poe2scout'
                  AND h.sample_at>=? AND h.price_exalted>0 ORDER BY h.sample_at""",
                (league, market_id, since)).fetchall()
            historical_span_days = ((historical[-1]["bucket_start"] - historical[0]["bucket_start"]) / 86400) if len(historical) > 1 else 0
            if len(historical) >= 24 and historical_span_days > own_span_days:
                rows = historical
                source = "poe2scout"
    by_date: dict[str, list[tuple[int, float]]] = {}
    for row in rows:
        local = datetime.fromtimestamp(row["bucket_start"], SEOUL)
        by_date.setdefault(local.date().isoformat(), []).append((local.hour, row["price"]))
    by_slot: dict[tuple[int, int], list[float]] = {}
    for day, values in by_date.items():
        daily_median = statistics.median(price for _, price in values)
        if daily_median <= 0:
            continue
        weekday = datetime.fromisoformat(day).weekday()
        hours: dict[int, list[float]] = {}
        for hour, value in values:
            hours.setdefault(hour, []).append((value / daily_median - 1) * 100)
        for hour, deviations in hours.items():
            by_slot.setdefault((weekday, hour), []).append(statistics.median(deviations))
    cells = [{"weekday": weekday, "hour": hour,
              "relative_percent": round(statistics.median(values), 3),
              "days": len(values)}
             for (weekday, hour), values in sorted(by_slot.items())]
    eligible = [cell for cell in cells if cell["days"] >= 3]
    span_days = ((rows[-1]["bucket_start"] - rows[0]["bucket_start"]) / 86400) if len(rows) > 1 else 0
    best = min(eligible, key=lambda item: item["relative_percent"]) if eligible and span_days >= 21 else None
    return {"league": league, "market_id": market_id, "unit": unit,
            "source": source,
            "official_volume": official_volume_summary(league, market_id, since),
            "timezone": "Asia/Seoul", "lookback_days": days,
            "first_sample_at": rows[0]["bucket_start"] if rows else None,
            "last_sample_at": rows[-1]["bucket_start"] if rows else None,
            "sample_count": len(rows), "observed_days": len(by_date),
            "cells": cells, "best_slot": best}


def statistical_market_summary(name: str, data: dict) -> dict:
    last = ord(name[-1]) if name else 0
    topic = "은" if 0xAC00 <= last <= 0xD7A3 and (last - 0xAC00) % 28 else "는"
    eligible = [cell for cell in data["cells"] if cell["days"] >= 3]
    highest = max(eligible, key=lambda cell: cell["relative_percent"]) if eligible else None
    lowest = min(eligible, key=lambda cell: cell["relative_percent"]) if eligible else None
    volumes = data["official_volume"].get("cells", [])
    busiest = max(volumes, key=lambda cell: cell["median_volume_item"]) if volumes else None
    days = ["월", "화", "수", "목", "금", "토", "일"]
    slot = lambda cell: f"{days[cell['weekday']]}요일 {cell['hour']:02d}시" if cell else "자료 없음"
    parts = []
    if highest: parts.append(f"{name}{topic} {slot(highest)}에 일별 중앙값보다 {highest['relative_percent']:+.2f}% 높은 경향이 있습니다.")
    if lowest: parts.append(f"상대적으로 낮았던 때는 {slot(lowest)}로 {lowest['relative_percent']:+.2f}%였습니다.")
    if busiest: parts.append(f"공식 교환량은 {slot(busiest)}에 중간값 {busiest['median_volume_item']:,.0f}개로 가장 많았습니다.")
    if not parts: parts.append("요일·시간별 경향을 판단할 표본을 더 모으고 있습니다.")
    confidence = "높음" if data["observed_days"] >= 42 else "보통" if data["observed_days"] >= 21 else "낮음"
    parts.append(f"{data['observed_days']}일, {data['sample_count']:,}회 관측 기준이며 신뢰도는 {confidence}입니다.")
    return {"summary": " ".join(parts), "generated_by": "statistics", "confidence": confidence}


async def ai_market_summary(name: str, data: dict) -> dict:
    fallback = statistical_market_summary(name, data)
    if not AI_API_KEY: return fallback
    payload = {"model": AI_MODEL, "temperature": 0.2, "max_tokens": 420, "system": "POE2 시세 통계를 한국어 3~4문장, 350자 이내로 요약한다. 최고가·저가 경향, 거래량 집중 시간, 표본 한계를 설명하고 가격을 예측하지 않는다. 제목, Markdown, 목록, 굵은 글씨 기호 없이 일반 문장만 출력한다.", "messages": [{"role": "user", "content": json.dumps({"item": name, "statistics": fallback, "data": data}, ensure_ascii=False)}]}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(AI_API_URL, headers={"x-api-key": AI_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}, json=payload)
            response.raise_for_status()
            content = response.json()["content"][0]["text"].strip()
        return {**fallback, "summary": content, "generated_by": "ai", "model": AI_MODEL}
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        logging.warning("AI market summary failed: %s", exc)
        return fallback



def save_live_observation(league: str, market_id: str, quote_data: dict):
    minute = int(time.time()) // 60 * 60
    with connect() as db:
        db.execute("""INSERT INTO live_observations
            (league,market_id,minute,price_divine,price_exalted) VALUES (?,?,?,?,?)
            ON CONFLICT(league,market_id,minute) DO UPDATE SET
              price_divine=excluded.price_divine, price_exalted=excluded.price_exalted""",
            (league, market_id, minute, quote_data.get("price_divine"),
             quote_data["price_exalted"]))


class Collector:
    def __init__(self):
        self.leagues = []
        self.last_leagues_at = 0
        self.locks = {}
        self.scout_metadata: dict[str, tuple[float, dict]] = {}
        self.request_sem = asyncio.Semaphore(3)
        self.host_retry_at: dict[str, float] = {}
        self.host_locks: dict[str, asyncio.Lock] = {}
        self.host_last_request: dict[str, float] = {}
        self.trade2_lock = asyncio.Lock()
        self.trade2_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
        self.trade2_last_request = 0.0
        self.trade2_retry_at = 0.0
        self.client = httpx.AsyncClient(timeout=25, follow_redirects=True,
                                        headers={"User-Agent": USER_AGENT})

    async def close(self):
        await self.client.aclose()

    async def _get_with_backoff(self, url: str, headers: dict | None = None):
        """GET with a shared request queue plus Retry-After/exponential backoff."""
        host = urlsplit(url).netloc
        delay = 1.0
        for attempt in range(MAX_HTTP_RETRIES):
            host_lock = self.host_locks.setdefault(host, asyncio.Lock())
            async with host_lock:
                async with self.request_sem:
                    remaining = self.host_retry_at.get(host, 0) - time.time()
                    if remaining > 0:
                        raise httpx.HTTPError(f"{host} rate limited; retry in {remaining:.0f}s")
                    gap = HTTP_MIN_GAP_SECONDS - (time.monotonic() - self.host_last_request.get(host, 0))
                    if gap > 0:
                        await asyncio.sleep(gap)
                    response = await self.client.get(url, headers=headers)
                    self.host_last_request[host] = time.monotonic()
            if response.status_code not in (429, 502, 503, 504):
                return response
            retry_after = response.headers.get("retry-after")
            if response.status_code == 429 or retry_after:
                self.host_retry_at[host] = time.time() + retry_after_seconds(retry_after)
                return response
            if attempt < MAX_HTTP_RETRIES - 1:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 8.0)
        return response

    async def get_trade2_exchange(self, league: str, have: str, want: str, force: bool = False):
        """Read the trade site's live bulk order book for one pair.

        This is the same unsupported endpoint used by the official trade web UI.
        Keep it selected-pair only, cache aggressively, and always honor 429/Retry-After.
        """
        if not TRADE2_LIVE_ENABLED:
            return None
        key = (league, have, want)
        cached = self.trade2_cache.get(key)
        if time.time() < self.trade2_retry_at:
            return None
        if not force and cached and time.time() - cached[0] < TRADE2_LIVE_SECONDS:
            return cached[1]

        async with self.trade2_lock:
            cached = self.trade2_cache.get(key)
            if not force and cached and time.time() - cached[0] < TRADE2_LIVE_SECONDS:
                return cached[1]
            if time.time() < self.trade2_retry_at:
                return None
            gap = TRADE2_MIN_GAP_SECONDS - (time.time() - self.trade2_last_request)
            if gap > 0:
                await asyncio.sleep(gap)
            url = f"{TRADE2_BASE}/api/trade2/exchange/poe2/{quote(league, safe='')}"
            body = {"query": {"status": {"option": "online"}, "have": [have], "want": [want]},
                    "sort": {"have": "asc"}, "engine": "new"}
            try:
                response = await self.client.post(url, json=body, headers={
                    "Accept": "application/json", "Content-Type": "application/json"})
            except httpx.HTTPError:
                self.trade2_retry_at = time.time() + TRADE2_LIVE_SECONDS
                return None
            self.trade2_last_request = time.time()
            if response.status_code == 429:
                retry = response.headers.get("retry-after")
                try:
                    wait = max(1.0, float(retry or 60))
                except ValueError:
                    wait = 60.0
                self.trade2_retry_at = time.time() + wait
                return None
            if response.status_code != 200:
                self.trade2_retry_at = time.time() + (300 if response.status_code in (401, 403, 404) else TRADE2_LIVE_SECONDS)
                return None

            try:
                payload = response.json()
            except ValueError:
                return None
            if not isinstance(payload, dict) or payload.get("error"):
                return None
            raw_results = payload.get("result") or []
            if not isinstance(raw_results, (dict, list)):
                return None
            values = raw_results if isinstance(raw_results, list) else list(raw_results.values())
            rates = []
            for value in values:
                if not isinstance(value, dict):
                    continue
                offers = ((value or {}).get("listing") or {}).get("offers") or []
                offer = offers[0] if offers else None
                exchange = (offer or {}).get("exchange") or {}
                item = (offer or {}).get("item") or {}
                ex_amount = finite_positive(exchange.get("amount"))
                item_amount = finite_positive(item.get("amount"))
                if (ex_amount and item_amount and exchange.get("currency") == have
                        and item.get("currency") == want):
                    rates.append(item_amount / ex_amount)
            if not rates:
                return None
            rates.sort(reverse=True)
            med0 = statistics.median(rates)
            clean = [r for r in rates if med0 / 3 <= r <= med0 * 3] or rates
            result = {
                "source": "GGG Trade2 live order book",
                "have": have, "want": want,
                "best": max(clean), "median": statistics.median(clean),
                "count": len(clean), "observed_at": int(time.time()),
                "cache_seconds": TRADE2_LIVE_SECONDS,
                "rate_limit_policy": response.headers.get("x-rate-limit-policy"),
                "rate_limit": response.headers.get("x-rate-limit-ip"),
                "rate_limit_state": response.headers.get("x-rate-limit-ip-state"),
            }
            self.trade2_cache[key] = (time.time(), result)
            return result

    async def get_live_market_quote(self, league: str, market_id: str, force: bool = False):
        if not TRADE2_LIVE_ENABLED or not market_id.startswith("exchange:Currency:"):
            return None
        api_id = market_id.rsplit(":", 1)[-1]
        if api_id not in TRADE2_MAJOR_IDS:
            return None
        if api_id == "exalted":
            return None
        quote_data = await self.get_trade2_exchange(league, api_id, "exalted", force=force)
        if not quote_data:
            return None
        price_exalted = quote_data["median"]
        if api_id == "divine":
            price_divine = 1.0
        else:
            divine = await self.get_trade2_exchange(league, "divine", "exalted", force=force)
            price_divine = price_exalted / divine["median"] if divine and divine.get("median") else None
        return {**quote_data, "price_exalted": price_exalted, "price_divine": price_divine}

    async def get_leagues(self):
        if self.leagues:
            if time.time() - self.last_leagues_at >= LEAGUE_CACHE_SECONDS:
                schedule_league_refresh()
            return self.leagues
        return await self.refresh_leagues()

    async def refresh_leagues(self):
        response = await self._get_with_backoff(f"{BASE}/leagues")
        response.raise_for_status()
        self.leagues = response.json()
        self.last_leagues_at = time.time()
        return self.leagues

    async def get_scout_items(self, league: str):
        cached = self.scout_metadata.get(league)
        if cached and time.time() - cached[0] < LEAGUE_CACHE_SECONDS:
            return cached[1]
        url = f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}/SnapshotPairs"
        try:
            response = await self._get_with_backoff(url)
            response.raise_for_status()
            items = {}
            for pair in response.json():
                for side in ("CurrencyOne", "CurrencyTwo"):
                    item = pair.get(side) or {}
                    if item.get("ApiId"):
                        items[item["ApiId"]] = item
            self.scout_metadata[league] = (time.time(), items)
            return items
        except (httpx.HTTPError, ValueError, KeyError):
            self.scout_metadata[league] = (time.time(), {})
            return {}

    async def refresh(self, league: str, categories: set[str] | None = None,
                      force: bool = False, min_interval: int | None = None):
        """Refresh selected categories, normally from the 15-minute market cache."""
        lock = self.locks.setdefault(league, asyncio.Lock())
        async with lock:
            with connect() as db:
                states = {r["category"]: dict(r) for r in db.execute(
                    "SELECT * FROM fetch_state WHERE league=?", (league,))}
            now = int(time.time())
            target_categories = set(categories or CATEGORIES.keys())
            interval = MARKET_POLL_SECONDS if min_interval is None else max(0, min_interval)
            due = [cat for cat in target_categories
                   if force or now - states.get(cat, {}).get("attempted_at", 0) >= interval]
            if not due:
                if categories is None:
                    schedule_job('scout-catalog:' + league, lambda: refresh_scout_catalog(league))
                return {"refreshed": [], "cached": sorted(target_categories)}

            scout_items = await self.get_scout_items(league)
            await asyncio.to_thread(enrich_exchange_metadata, league, scout_items)
            refreshed: list[str] = []
            cached = sorted(target_categories - set(due))

            async def one(category):
                state = states.get(category, {})
                path = ("exchange/current/overview" if category in EXCHANGE_TYPES
                        else "stash/current/item/overview")
                url = f"{BASE}/{path}?league={quote(league)}&type={quote(category)}"
                headers = {"Cache-Control": "no-cache"} if force else {}
                if not force:
                    if state.get("etag"):
                        headers["If-None-Match"] = state["etag"]
                    if state.get("last_modified"):
                        headers["If-Modified-Since"] = state["last_modified"]
                try:
                    response = await self._get_with_backoff(url, headers=headers)
                    if response.status_code != 304:
                        response.raise_for_status()
                        rows = normalize(category, response.json(), scout_items)
                        if not rows:
                            raise ValueError("Empty or invalid market response")
                        await asyncio.to_thread(save_markets, league, rows)
                    with connect() as db:
                        db.execute("""INSERT INTO fetch_state
                            (league,category,etag,last_modified,fetched_at,attempted_at,error)
                            VALUES (?,?,?,?,?,?,NULL)
                            ON CONFLICT(league,category) DO UPDATE SET
                            etag=excluded.etag,last_modified=excluded.last_modified,
                            fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error=NULL""",
                            (league, category, response.headers.get("etag") or state.get("etag"),
                             response.headers.get("last-modified") or state.get("last_modified"), now, now))
                        db.execute("INSERT INTO cache_events(source,key,event,status,created_at) VALUES(?,?,?,?,?)",
                                   ("poe.ninja", f"{league}:{category}",
                                    "revalidated" if response.status_code == 304 else "fetched",
                                    response.status_code, now))
                    refreshed.append(category)
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    with connect() as db:
                        db.execute("""INSERT INTO fetch_state
                            (league,category,etag,last_modified,fetched_at,attempted_at,error)
                            VALUES (?,?,?,?,?,?,?)
                            ON CONFLICT(league,category) DO UPDATE SET
                            attempted_at=excluded.attempted_at,error=excluded.error""",
                            (league, category, state.get("etag"), state.get("last_modified"),
                             state.get("fetched_at", 0), now, str(exc)[:250]))
                        db.execute("INSERT INTO cache_events(source,key,event,status,created_at) VALUES(?,?,?,?,?)",
                                   ("poe.ninja", f"{league}:{category}", "error", None, now))

            await asyncio.gather(*(one(cat) for cat in due))
            await asyncio.to_thread(sample_prices)
            if categories is None and refreshed:
                await asyncio.to_thread(sample_market_snapshots, league, now)
            if refreshed:
                overlay_snapshots.invalidate(league)
                await asyncio.to_thread(overlay_snapshots.get, league, connect)
            if categories is None:
                schedule_job('scout-catalog:' + league, lambda: refresh_scout_catalog(league))
            return {"refreshed": sorted(refreshed), "cached": cached}

    async def refresh_market(self, league: str, market_id: str, force: bool = False):
        """Refresh only the selected market's category on the short cadence."""
        with connect() as db:
            row = db.execute("SELECT category FROM markets WHERE league=? AND id=?",
                             (league, market_id)).fetchone()
        if row is None:
            return {"refreshed": [], "cached": []}
        return await self.refresh(league, categories={row["category"]}, force=force,
                                  min_interval=0 if force else SELECTED_POLL_SECONDS)


collector = Collector()
scout_cache: dict[tuple[str, str], tuple[float, dict]] = {}


def schedule_job(key, operation):
    task = collection_tasks.get(key)
    if task is None or task.done():
        async def run():
            try:
                await operation()
            except Exception:
                LOGGER.exception("Background collection failed: %s", key)
        collection_tasks[key] = asyncio.create_task(run())


def schedule_league_refresh():
    schedule_job('leagues', collector.refresh_leagues)


def schedule_collection(league):
    schedule_job('market:' + league, lambda: collector.refresh(league))


async def refresh_scout_catalog(league):
    db = connect()
    try:
        last = db.execute('SELECT MAX(fetched_at) FROM scout_catalog WHERE league=?', (league,)).fetchone()[0]
    finally:
        db.close()
    if last and time.time() - last < MARKET_POLL_SECONDS:
        return 0
    base = 'https://api.poe2scout.com/poe2'
    responses = []
    for path in [f'/Leagues/{quote(league, safe="")}/Items',
                 f'/Leagues/{quote(league, safe="")}/Items/PriceHistory', '/Leagues']:
        response = await collector._get_with_backoff(base + path)
        response.raise_for_status()
        responses.append(response.json())
    info = next((item for item in responses[2] if item.get('Value') == league), None)
    if info is None:
        raise ValueError('Scout league not found')
    return await asyncio.to_thread(save_catalog, connect, league, responses[0], responses[1], info, korean_name)


async def overlay_prices(payload: OverlayRequest, request: Request):
    try:
        valid = await collector.get_leagues()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"League source unavailable: {exc}") from exc
    if payload.league not in {item['id'] for item in valid}:
        raise HTTPException(400, 'Unknown league')
    snapshot, db_ms, cache_ms = await asyncio.to_thread(
        overlay_snapshots.get, payload.league, connect)
    if not snapshot[0]:
        schedule_collection(payload.league)
    return overlay_response(payload, snapshot, request, db_ms, cache_ms)


async def sample_loop():
    while True:
        await asyncio.sleep(60 - time.time() % 60)
        try:
            await asyncio.to_thread(sample_prices)
        except Exception:
            LOGGER.exception("Minute price sampling failed; retrying next minute")


async def refresh_loop():
    while True:
        try:
            leagues = await collector.get_leagues()
            # Refresh only leagues used in this local installation.
            with connect() as db:
                used = {r[0] for r in db.execute("SELECT DISTINCT league FROM markets")}
            used.add(os.getenv("POE_DEFAULT_LEAGUE", leagues[0]["id"]))
            for league in used:
                if any(item["id"] == league for item in leagues):
                    await collector.refresh(league, min_interval=MARKET_POLL_SECONDS)
        except Exception:
            LOGGER.exception("Market refresh failed; retrying next minute")
        await asyncio.sleep(60)


async def fetch_official_exchange_hour(hour_start: int):
    response = await collector._get_with_backoff(f"{OFFICIAL_EXCHANGE_BASE}/{hour_start}")
    if response.status_code != 200:
        raise httpx.HTTPError(f"GGG exchange hour {hour_start}: HTTP {response.status_code}")
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("GGG exchange response is not an object")
    return await asyncio.to_thread(save_official_exchange_hour, hour_start, payload)


async def official_exchange_loop():
    while True:
        for hour_start in await asyncio.to_thread(official_missing_hours):
            try:
                count = await fetch_official_exchange_hour(hour_start)
                LOGGER.info("Stored GGG exchange hour %s (%s mapped pairs)", hour_start, count)
            except (httpx.HTTPError, ValueError):
                LOGGER.exception("Official exchange hour %s will be retried", hour_start)
                break
            await asyncio.sleep(2)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    await asyncio.to_thread(load_korean_names)
    with connect() as db:
        existing_leagues = [row[0] for row in db.execute("SELECT DISTINCT league FROM markets")]
    for league in existing_leagues:
        await asyncio.to_thread(sample_market_snapshots, league)
    tasks = [asyncio.create_task(sample_loop()), asyncio.create_task(refresh_loop()),
             asyncio.create_task(official_exchange_loop())]
    yield
    for task in tasks:
        task.cancel()
    for task in collection_tasks.values():
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await asyncio.gather(*collection_tasks.values(), return_exceptions=True)
    await collector.close()


app = FastAPI(title="PoE2 Chart API", lifespan=lifespan)
app.include_router(build_router)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST"], allow_headers=["*"],
                   expose_headers=["ETag", "Server-Timing"])
app.add_api_route('/api/overlay/prices', overlay_prices, methods=['POST'])


@app.post('/api/items/inspect')
def item_inspect(payload: InspectItem):
    try:
        return inspect_item(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get('/api/catalog')
async def item_catalog(league: str = Query(min_length=1, max_length=120)):
    try:
        valid = await collector.get_leagues()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f'League source unavailable: {exc}') from exc
    if league not in {item['id'] for item in valid}:
        raise HTTPException(400, 'Unknown league')
    result = await asyncio.to_thread(combined_catalog, connect, league)
    if not result['scout']:
        schedule_job('scout-catalog:' + league, lambda: refresh_scout_catalog(league))
    return result


@app.get('/tools/item-check')
def item_check_page():
    return FileResponse(ROOT / 'frontend' / 'public' / 'item-check.html')


@app.get("/api/leagues")
async def leagues():
    try:
        return await collector.get_leagues()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"League source unavailable: {exc}") from exc


@app.get("/api/market-icon/{market_id:path}")
async def market_icon(market_id: str, league: str = Query(min_length=1, max_length=120)):
    path = await cached_market_icon(league, market_id)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/markets")
async def markets(league: str = Query(min_length=1)):
    try:
        valid = await collector.get_leagues()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"League source unavailable: {exc}") from exc
    if league not in {item["id"] for item in valid}:
        raise HTTPException(400, "Unknown league")
    with connect() as db:
        has_market = db.execute("SELECT 1 FROM markets WHERE league=? LIMIT 1", (league,)).fetchone()
    if not has_market:
        schedule_collection(league)
    now = int(time.time())
    with connect() as db:
        items = [dict(row) for row in db.execute("""SELECT m.*,d.variant,d.details_id,
            d.item_level AS level_required,d.corrupted,COALESCE(o.display_order,999999) AS display_order
            FROM markets m LEFT JOIN market_display_order o
              ON o.league=m.league AND o.market_id=m.id
            LEFT JOIN market_metadata d ON d.league=m.league AND d.market_id=m.id
            WHERE m.league=? ORDER BY m.category,display_order,m.id""", (league,))]
        states = [dict(row) for row in db.execute(
            "SELECT category,fetched_at,attempted_at,error,etag,last_modified FROM fetch_state WHERE league=?",
            (league,))]
        exalted = db.execute("""SELECT price_divine FROM markets
            WHERE league=? AND id='exchange:Currency:exalted'""", (league,)).fetchone()
    cooldown = collector.host_retry_at.get(urlsplit(BASE).netloc, 0)
    states = [source_status_view(state, MARKET_POLL_SECONDS, now, cooldown) for state in states]
    return {"markets": items, "state": "ready" if items else "collecting",
            "categories": CATEGORIES, "source_status": states,
            "exalted_per_divine": round(1 / exalted[0], 4) if exalted else None,
            "sample_interval_seconds": 60,
            "history_snapshot_seconds": HISTORY_SNAPSHOT_SECONDS,
            "upstream_poll_seconds": MARKET_POLL_SECONDS,
            "selected_poll_seconds": SELECTED_POLL_SECONDS,
            "scout_poll_seconds": SCOUT_POLL_SECONDS,
            "league_cache_seconds": LEAGUE_CACHE_SECONDS,
            "trade2_live_enabled": TRADE2_LIVE_ENABLED,
            "trade2_live_seconds": TRADE2_LIVE_SECONDS}


@app.get("/api/seasonality/{market_id:path}")
def market_seasonality(market_id: str, league: str = Query(min_length=1),
                       days: int = Query(default=56, ge=7, le=365), unit: str = "exalted"):
    if unit not in {"exalted", "divine"} and not (unit == "chaos" and market_id in {"exchange:Currency:exalted", "exchange:Currency:divine"}):
        raise HTTPException(400, "Unsupported unit for this market")
    with connect() as db:
        exists = db.execute("SELECT 1 FROM markets WHERE league=? AND id=?",
                            (league, market_id)).fetchone()
    if not exists:
        raise HTTPException(404, "Unknown market")
    return seasonality(league, market_id, days, unit)


@app.get("/api/market-summary/{market_id:path}")
async def market_summary(market_id: str, league: str = Query(min_length=1), days: int = Query(default=56, ge=7, le=365), unit: str = "exalted"):
    data = seasonality(league, market_id, days, unit)
    with connect() as db: market = db.execute("SELECT name FROM markets WHERE league=? AND id=?", (league, market_id)).fetchone()
    if not market: raise HTTPException(404, "Unknown market")
    key = f"{league}:{market_id}:{days}:{unit}"
    cached = AI_SUMMARY_CACHE.get(key)
    if cached and time.time() - cached[0] < AI_SUMMARY_TTL: return cached[1]
    result = await ai_market_summary(market["name"], data)
    AI_SUMMARY_CACHE[key] = (time.time(), result)
    return result


@app.get("/api/candles/{market_id:path}")
async def candles(market_id: str, league: str = Query(min_length=1), interval: str = "1m",
                  unit: str = "divine", limit: int = Query(500, ge=1, le=2000)):
    seconds = {"1m": 60, "5m": 300, "1h": 3600, "1d": 86400}.get(interval)
    if seconds is None:
        raise HTTPException(400, "Unsupported interval")
    if unit not in ("divine", "exalted") and not (unit == "chaos" and market_id in {"exchange:Currency:exalted", "exchange:Currency:divine"}):
        raise HTTPException(400, "Unsupported unit")
    await collector.refresh_market(league, market_id)
    live_quote = await collector.get_live_market_quote(league, market_id) if unit != "chaos" else None
    if live_quote:
        await asyncio.to_thread(save_live_observation, league, market_id, live_quote)
    with connect() as db:
        market = db.execute("SELECT * FROM markets WHERE league=? AND id=?",
                            (league, market_id)).fetchone()
        if market is None:
            raise HTTPException(404, "Market not found")
        minute = int(time.time()) // 60 * 60
        db.execute("""INSERT INTO tracked (league,market_id,last_viewed) VALUES (?,?,?)
            ON CONFLICT(league,market_id) DO UPDATE SET last_viewed=excluded.last_viewed""",
            (league, market_id, int(time.time())))
        ex = db.execute("""SELECT price_divine FROM markets WHERE league=?
            AND id='exchange:Currency:exalted'""", (league,)).fetchone()
        chaos = db.execute("""SELECT price_divine FROM markets WHERE league=?
            AND id='exchange:Currency:chaos'""", (league,)).fetchone()
        price_exalted = market["price_divine"] / ex[0] if ex and ex[0] > 0 else None
        price_chaos = market["price_divine"] / chaos[0] if chaos and chaos[0] > 0 else None
        db.execute("""INSERT OR IGNORE INTO observations
            (league,market_id,minute,price_divine,price_exalted,price_chaos) VALUES (?,?,?,?,?,?)""",
            (league, market_id, minute, market["price_divine"], price_exalted, price_chaos))
        column = "price_divine" if unit == "divine" else "price_exalted"
        use_live = bool(unit != "chaos" and live_quote and (unit == "exalted" or live_quote.get("price_divine")))
        table = "live_observations" if use_live else "observations"
        if unit == "chaos":
            minute_rows = [dict(row) for row in db.execute("""SELECT minute,price_chaos AS price
                FROM observations WHERE league=? AND market_id=? AND price_chaos>0
                ORDER BY minute DESC LIMIT ?""", (league, market_id, min(20000, limit * max(1, seconds // 60))))]
            since = max(0, int(time.time()) - max(seconds * limit * 2, HISTORY_SNAPSHOT_SECONDS * limit))
            snapshot_rows = [{"minute": row["bucket_start"], "price": row["price"]}
                             for row in currency_chaos_snapshots(db, league, market_id, since)]
            by_minute = {row["minute"]: row for row in snapshot_rows}
            by_minute.update({row["minute"]: row for row in minute_rows})
            data = sorted(by_minute.values(), key=lambda row: row["minute"], reverse=True)[:min(50000, limit * max(1, seconds // 60))]
        else:
            data = [dict(row) for row in db.execute(f"""SELECT minute, {column} AS price FROM {table}
                WHERE league=? AND market_id=? ORDER BY minute DESC LIMIT ?""",
                (league, market_id, min(20000, limit * (seconds // 60))))]
        state = db.execute("""SELECT category,fetched_at,attempted_at,error,etag,last_modified
            FROM fetch_state WHERE league=? AND category=?""",
            (league, market["category"])).fetchone()
    data.reverse()
    buckets = {}
    for point in data:
        bucket = point["minute"] // seconds * seconds
        price = point["price"]
        if price is None:
            continue
        if bucket not in buckets:
            buckets[bucket] = {"time": bucket, "open": price, "high": price,
                               "low": price, "close": price, "samples": 1}
        else:
            candle = buckets[bucket]
            candle["high"] = max(candle["high"], price)
            candle["low"] = min(candle["low"], price)
            candle["close"] = price
            candle["samples"] += 1
    now = int(time.time())
    source_status = None
    if state is not None:
        source_status = source_status_view(
            dict(state), SELECTED_POLL_SECONDS, now,
            collector.host_retry_at.get(urlsplit(BASE).netloc, 0))
    return {"candles": list(buckets.values())[-limit:], "interval": interval,
            "kind": "live_listings" if use_live else "observed_snapshots", "unit": unit,
            "market": dict(market),
            "exalted_per_divine": round(1 / ex[0], 4) if ex else None,
            "source_status": source_status,
            "live_quote": live_quote}


@app.get("/api/live/{market_id:path}")
async def live_quote(market_id: str, league: str = Query(min_length=1)):
    quote_data = await collector.get_live_market_quote(league, market_id)
    if quote_data is None:
        raise HTTPException(404, "Live Trade2 quote is unavailable")
    await asyncio.to_thread(save_live_observation, league, market_id, quote_data)
    return quote_data


@app.post("/api/refresh")
async def manual_refresh(league: str = Query(min_length=1), market_id: str | None = None,
                         scope: str = "selected"):
    """Manual refresh bypasses the local cache and conditional HTTP revalidation."""
    try:
        valid = await collector.get_leagues()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"League source unavailable: {exc}") from exc
    if league not in {item["id"] for item in valid}:
        raise HTTPException(400, "Unknown league")
    if scope == "selected":
        if not market_id:
            raise HTTPException(400, "market_id is required for selected refresh")
        result = await collector.refresh_market(league, market_id, force=True)
        if not result["refreshed"]:
            raise HTTPException(502, "Selected market refresh failed; previous price is retained")
        scout_cache.pop((league, market_id), None)
        live_quote = await collector.get_live_market_quote(league, market_id, force=True)
        if live_quote:
            await asyncio.to_thread(save_live_observation, league, market_id, live_quote)
    elif scope == "all":
        result = await collector.refresh(league, force=True, min_interval=0)
        if not result["refreshed"]:
            raise HTTPException(502, "Market refresh failed; previous prices are retained")
        scout_cache.clear()
    else:
        raise HTTPException(400, "scope must be selected or all")
    return {"ok": True, "scope": scope, **result, "time": int(time.time())}


@app.get("/api/health")
def health():
    with connect() as db:
        league = os.getenv("POE_DEFAULT_LEAGUE")
        if not league:
            active = db.execute("SELECT league FROM markets ORDER BY observed_at DESC LIMIT 1").fetchone()
            league = active[0] if active else None
        row = db.execute("""SELECT MAX(s.bucket_start) FROM market_snapshots s
            JOIN market_keys k ON k.id=s.market_key WHERE k.league=?""",
                         (league,)).fetchone() if league else None
    latest = row[0] if row else None
    return {"ok": True, "time": int(time.time()), "league": league,
            "last_market_snapshot_at": latest,
            "snapshot_age_seconds": int(time.time()) - latest if latest else None}


@app.get("/api/scout/{market_id:path}")
async def scout_reference(market_id: str, league: str = Query(min_length=1)):
    """Optional POE2Scout reference for exchange items; its logs are not minute candles."""
    with connect() as db:
        market = db.execute("SELECT source_kind FROM markets WHERE league=? AND id=?",
                            (league, market_id)).fetchone()
    if market is None:
        raise HTTPException(404, "Market not found")
    if market["source_kind"] not in ("exchange", "reference"):
        raise HTTPException(404, "Scout reference is available for exchange items only")
    key = (league, market_id)
    cached = scout_cache.get(key)
    if cached and time.time() - cached[0] < SCOUT_POLL_SECONDS:
        return cached[1]
    api_id = market_id.rsplit(":", 1)[-1]
    url = (f"https://api.poe2scout.com/poe2/Leagues/{quote(league, safe='')}"
           f"/Currencies/{quote(api_id, safe='')}")
    try:
        response = await collector._get_with_backoff(url)
        response.raise_for_status()
        raw = response.json()
        logs = [{"time": item["Time"], "price_exalted": item["Price"],
                 "quantity": item.get("Quantity")}
                for item in raw.get("PriceLogs", []) if item and finite_positive(item.get("Price"))]
        if not logs:
            raise ValueError("No price history")
        result = {"source": "POE2Scout", "unit": "exalted", "name": korean_name(raw.get("Text")),
                  "current_price_exalted": logs[0]["price_exalted"], "logs": logs[:30],
                  "note": "POE2Scout exchange history; source samples are not 1-minute trades"}
        scout_cache[key] = (time.time(), result)
        return result
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, f"Scout reference unavailable: {exc}") from exc


FRONTEND_DIST = ROOT / "frontend" / "dist"
if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="dashboard")
