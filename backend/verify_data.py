"""Read-only checks for the market collector and historical import."""

import json
import time

from app import connect


def verify():
    with connect() as db:
        current = db.execute("SELECT league,COUNT(*),MAX(observed_at) FROM markets GROUP BY league").fetchall()
        snapshots = db.execute("""SELECT k.league,COUNT(*),MAX(s.bucket_start)
            FROM market_snapshots s JOIN market_keys k ON k.id=s.market_key
            GROUP BY k.league""").fetchall()
        history = db.execute("""SELECT k.league,h.source,COUNT(*),COUNT(DISTINCT k.market_id),
            MIN(h.sample_at),MAX(h.sample_at),MIN(h.price_exalted),MAX(h.price_exalted)
            FROM external_price_history h JOIN market_keys k ON k.id=h.market_key
            GROUP BY k.league,h.source""").fetchall()
        divine = db.execute("""SELECT COUNT(*),MIN(h.sample_at),MAX(h.sample_at),
            MIN(h.price_exalted),MAX(h.price_exalted) FROM external_price_history h
            JOIN market_keys k ON k.id=h.market_key
            WHERE k.league='Forbidden Rites' AND k.market_id='exchange:Currency:divine'""").fetchone()
        official_hours = db.execute("SELECT COUNT(*),MIN(hour_start),MAX(hour_start) FROM official_exchange_hours").fetchone()
        official_volume = db.execute("""SELECT league,market_id,COUNT(*),SUM(volume_item),MAX(hour_start)
            FROM official_exchange_volume GROUP BY league,market_id""").fetchall()
    now = int(time.time())
    result = {
        "now": now,
        "markets": [dict(league=r[0], items=r[1], latest_at=r[2]) for r in current],
        "snapshots": [dict(league=r[0], rows=r[1], latest_at=r[2], age_seconds=now-r[2])
                      for r in snapshots],
        "external_history": [dict(league=r[0], source=r[1], rows=r[2], items=r[3],
                                  first_at=r[4], last_at=r[5], min_price=r[6], max_price=r[7])
                             for r in history],
        "divine_history": dict(rows=divine[0], first_at=divine[1], last_at=divine[2],
                               min_price=divine[3], max_price=divine[4]),
        "official_exchange": {
            "completed_hours": official_hours[0], "first_hour": official_hours[1],
            "last_hour": official_hours[2],
            "mapped_pairs": [dict(league=r[0], market_id=r[1], hours=r[2],
                                  traded_items=r[3], last_hour=r[4]) for r in official_volume]},
    }
    assert all(row["rows"] > 0 for row in result["snapshots"])
    assert all(row["min_price"] > 0 and row["last_at"] <= now for row in result["external_history"])
    return result


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, indent=2))
