"""
query_categories.py  <db_path> <today_start_iso> <now_iso>

Windowing policy:
- todayCategories: today (00:00 -> now)
- recapCategories: rolling last 7 days
- transitions: rolling last 7 days
"""
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from urllib.parse import urlparse


_TRANSITION_DESC: dict[tuple[str, str], str] = {
    ("education", "entertainment"): "Break from learning, seeking reward.",
    ("education", "gaming"): "High intensity switch to play.",
    ("education", "social"): "Checking in after a study session.",
    ("education", "music"): "Music break mid-study.",
    ("education", "shopping"): "Reward browsing after studying.",
    ("productivity", "entertainment"): "Unwinding after productive work.",
    ("productivity", "social"): "Quick social break between tasks.",
    ("productivity", "gaming"): "Escaping work stress through gaming.",
    ("productivity", "music"): "Background audio after a focus session.",
    ("productivity", "shopping"): "Browsing during a work break.",
    ("finance", "entertainment"): "Relaxing after business tasks.",
    ("finance", "gaming"): "Gaming break after financial reading.",
    ("news", "entertainment"): "Light content after heavy news.",
    ("news", "social"): "Social reaction after news consumption.",
    ("health", "entertainment"): "Leisure time after wellness content.",
    ("health", "social"): "Social browsing after lifestyle content.",
}

ALLOWED_CATEGORIES = {
    "education",
    "entertainment",
    "news",
    "music",
    "gaming",
    "shopping",
    "productivity",
    "health",
    "social",
    "finance",
}

LEGACY_MAP = {
    "education or tech tutorials": "education",
    "entertainment or vlogs": "entertainment",
    "news or politics": "news",
    "music or audio": "music",
    "gaming or streaming": "gaming",
    "shopping or reviews": "shopping",
    "work or productivity tools": "productivity",
    "health or lifestyle": "health",
    "social media or forums": "social",
    "finance or business": "finance",
    "other": "",
    "uncategorized": "",
}

APP_HINTS = {
    "spotify": "music",
    "discord": "social",
    "steam": "gaming",
    "epicgameslauncher": "gaming",
    "vlc": "entertainment",
    "cursor": "productivity",
    "code": "productivity",
    "pycharm": "productivity",
    "webstorm": "productivity",
    "idea": "productivity",
    "notion": "productivity",
    "obsidian": "productivity",
    "excel": "productivity",
    "winword": "productivity",
    "powerpnt": "productivity",
    "postman": "productivity",
    "dbeaver": "productivity",
}


def _get_description(from_cat: str, to_cat: str) -> str:
    desc = _TRANSITION_DESC.get((from_cat, to_cat))
    if desc:
        return desc
    return f"Shifting from {from_cat.capitalize()} to {to_cat.capitalize()}."


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{round(seconds)}s"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours == 0:
        return f"{minutes}m"
    return f"{hours}h {minutes}m"


def _label(raw: str) -> str:
    return raw.capitalize()


def _infer_category_from_context(row: sqlite3.Row) -> str:
    source = (row["source"] or "").strip().lower()
    app = (row["app"] or "").strip().lower()
    url = (row["url"] or "").strip().lower()
    title = (row["title"] or "").strip().lower()
    classification = (row["classification"] or "").strip().upper()

    if source == "app":
        for key, cat in APP_HINTS.items():
            if key in app:
                return cat

    host = ""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        pass

    text = f"{host} {title} {url}"
    if any(k in text for k in ("github", "stackoverflow", "docs.", "tutorial", "course", "khanacademy", "coursera", "udemy")):
        return "education"
    if any(k in text for k in ("reuters", "bbc", "cnn", "ndtv", "timesofindia", "/news")):
        return "news"
    if any(k in text for k in ("amazon", "flipkart", "myntra", "ebay", "cart", "checkout", "review")):
        return "shopping"
    if any(k in text for k in ("tradingview", "moneycontrol", "invest", "stocks", "crypto", "finance")):
        return "finance"
    if any(k in text for k in ("spotify", "soundcloud", "music", "podcast", "audio")):
        return "music"
    if any(k in text for k in ("twitch", "steamcommunity", "esports", "gaming")):
        return "gaming"
    if any(k in text for k in ("reddit", "twitter", "x.com", "facebook", "instagram", "tiktok", "forum")):
        return "social"
    if any(k in text for k in ("workout", "health", "lifestyle", "wellness", "diet", "meditation")):
        return "health"
    if any(k in text for k in ("youtube", "netflix", "primevideo", "hotstar", "entertainment", "vlog")):
        return "entertainment"

    if classification == "PRODUCTIVE":
        return "productivity"
    if classification == "DISTRACTIVE":
        return "entertainment"
    return "productivity"


def _normalize_category(row: sqlite3.Row) -> str:
    raw = (row["category"] or "").strip().lower()
    raw = LEGACY_MAP.get(raw, raw)
    if raw in ALLOWED_CATEGORIES:
        return raw
    return _infer_category_from_context(row)


def _top8_with_percent(cat_map: dict[str, float]) -> list[dict]:
    if not cat_map:
        return []
    total = sum(cat_map.values()) or 1.0
    rows = sorted(
        (
            {
                "category": _label(cat),
                "categoryKey": cat,
                "seconds": round(secs, 2),
                "percent": round((secs / total) * 100, 1),
                "formattedTime": _fmt_duration(secs),
            }
            for cat, secs in cat_map.items()
        ),
        key=lambda x: x["seconds"],
        reverse=True,
    )[:8]
    return rows


def _aggregate(rows: list[sqlite3.Row]) -> dict[str, float]:
    cat_map: dict[str, float] = {}
    for row in rows:
        cat = _normalize_category(row)
        dur = float(row["duration_seconds"] or 0.0)
        weight = dur if dur > 0 else 1.0
        cat_map[cat] = cat_map.get(cat, 0.0) + weight
    return cat_map


def _compute_transitions(rows: list[sqlite3.Row]) -> list[dict]:
    counts: dict[tuple[str, str], int] = defaultdict(int)

    for i in range(len(rows) - 1):
        curr = rows[i]
        nxt = rows[i + 1]
        if curr["classification"] != "PRODUCTIVE" or nxt["classification"] != "DISTRACTIVE":
            continue
        try:
            t1 = datetime.fromisoformat(curr["ts"])
            t2 = datetime.fromisoformat(nxt["ts"])
            gap_seconds = (t2 - t1).total_seconds()
            if gap_seconds < 0 or gap_seconds > 600:
                continue
        except Exception:
            continue

        from_cat = _normalize_category(curr)
        to_cat = _normalize_category(nxt)
        if from_cat != to_cat:
            counts[(from_cat, to_cat)] += 1

    if not counts:
        return []

    max_count = max(counts.values())
    transitions = sorted(
        (
            {
                "fromCategory": _label(f),
                "fromCategoryKey": f,
                "toCategory": _label(t),
                "toCategoryKey": t,
                "strength": round(count / max_count, 2),
                "count": count,
                "description": _get_description(f, t),
            }
            for (f, t), count in counts.items()
        ),
        key=lambda x: x["count"],
        reverse=True,
    )[:5]
    return transitions


def _fetch_rows(conn: sqlite3.Connection, start_iso: str, end_iso: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT classification, category, source, app, url, title, duration_seconds,
               event_timestamp, timestamp,
               COALESCE(event_timestamp, timestamp) AS ts
        FROM events
        WHERE COALESCE(event_timestamp, timestamp) >= ?
          AND COALESCE(event_timestamp, timestamp) <= ?
        ORDER BY COALESCE(event_timestamp, timestamp) ASC
        """,
        (start_iso, end_iso),
    ).fetchall()


def main() -> None:
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: query_categories.py <db_path> <start_iso> <end_iso>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    start_iso = sys.argv[2]  # today start (from route)
    end_iso = sys.argv[3]    # now

    try:
        end_dt = datetime.fromisoformat(end_iso)
    except Exception:
        end_dt = datetime.now()
    start_7d_iso = (end_dt - timedelta(days=7)).isoformat(timespec="milliseconds")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    cols = {row[1] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
    if "category" not in cols:
        print(json.dumps({
            "todayCategories": [],
            "recapCategories": [],
            "allTimeCategories": [],
            "transitions": [],
            "stale": False,
            "staleMinutes": None,
            "lastUpdated": None,
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "error": "category column not yet present — restart api_server to migrate",
        }))
        sys.exit(0)

    today_rows = _fetch_rows(conn, start_iso, end_iso)
    recap_rows_7d = _fetch_rows(conn, start_7d_iso, end_iso)
    transitions = _compute_transitions(
        [r for r in recap_rows_7d if (r["classification"] or "") in ("PRODUCTIVE", "DISTRACTIVE")]
    )

    conn.close()

    today_map = _aggregate(today_rows)
    recap_map = _aggregate(recap_rows_7d)

    last_updated = None
    for row in recap_rows_7d:
        ts = row["event_timestamp"] or row["timestamp"]
        if ts and (last_updated is None or ts > last_updated):
            last_updated = ts

    stale = False
    stale_minutes = None
    if last_updated:
        try:
            dt = datetime.fromisoformat(last_updated)
            diff_mins = (datetime.now() - dt).total_seconds() / 60
            stale_minutes = round(diff_mins, 1)
            stale = diff_mins > 5
        except Exception:
            pass

    recap_categories = _top8_with_percent(recap_map)
    print(json.dumps({
        "todayCategories": _top8_with_percent(today_map),
        "recapCategories": recap_categories,
        # Keep compatibility for older UI readers
        "allTimeCategories": recap_categories,
        "transitions": transitions,
        "stale": stale,
        "staleMinutes": stale_minutes,
        "lastUpdated": last_updated,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "windows": {
            "today": {"start": start_iso, "end": end_iso},
            "recap7d": {"start": start_7d_iso, "end": end_iso},
            "transitions7d": {"start": start_7d_iso, "end": end_iso},
        },
    }))


if __name__ == "__main__":
    main()
