"""
query_category_items.py  <db_path> <category_key> <start_iso> <end_iso>

Returns:
{
  "category": "productivity",
  "topItems": [
    { "name": "youtube.com", "type": "site", "durationSeconds": 1234, "percent": 42.1, "eventCount": 8, "formattedTime": "20m" }
  ],
  "window": { "start": "...", "end": "..." }
}
"""
import json
import sqlite3
import sys
from urllib.parse import urlparse


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


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{round(seconds)}s"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours == 0:
        return f"{minutes}m"
    return f"{hours}h {minutes}m"


def _normalize_site(url: str, title: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower().strip()
        if host.startswith("www."):
            host = host[4:]
        if host:
            return host
    except Exception:
        pass
    if title:
        return title.strip()[:80]
    return "unknown-site"


def _normalize_app(app_name: str, title: str) -> str:
    n = (app_name or "").strip().lower()
    if n.startswith("app://"):
        n = n[6:]
    if n.endswith(".exe"):
        n = n[:-4]
    if n:
        return n
    if title:
        return title.strip()[:80]
    return "unknown-app"


def _infer_fallback_category(row: sqlite3.Row) -> str:
    source = (row["source"] or "").strip().lower()
    app = (row["app"] or "").strip().lower()
    url = (row["url"] or "").strip().lower()
    title = (row["title"] or "").strip().lower()
    classification = (row["classification"] or "").strip().upper()
    text = f"{app} {url} {title}"

    if source == "app":
        if any(k in app for k in ("spotify",)):
            return "music"
        if any(k in app for k in ("discord",)):
            return "social"
        if any(k in app for k in ("steam", "epicgameslauncher")):
            return "gaming"
        if any(k in app for k in ("cursor", "code", "pycharm", "webstorm", "idea", "notion", "obsidian", "postman", "dbeaver")):
            return "productivity"

    if any(k in text for k in ("github", "stackoverflow", "tutorial", "course", "docs.")):
        return "education"
    if any(k in text for k in ("/news", "bbc", "cnn", "reuters", "ndtv", "timesofindia")):
        return "news"
    if any(k in text for k in ("amazon", "flipkart", "myntra", "ebay", "review")):
        return "shopping"
    if any(k in text for k in ("finance", "stocks", "crypto", "invest", "moneycontrol", "tradingview")):
        return "finance"
    if any(k in text for k in ("spotify", "soundcloud", "podcast", "audio", "music")):
        return "music"
    if any(k in text for k in ("gaming", "twitch", "steamcommunity", "esports")):
        return "gaming"
    if any(k in text for k in ("reddit", "twitter", "x.com", "facebook", "instagram", "tiktok", "forum")):
        return "social"
    if any(k in text for k in ("health", "wellness", "lifestyle", "diet", "workout", "meditation")):
        return "health"
    if any(k in text for k in ("youtube", "netflix", "hotstar", "primevideo", "entertainment", "vlog")):
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
    return _infer_fallback_category(row)


def main() -> None:
    if len(sys.argv) < 5:
        print(json.dumps({"error": "usage: query_category_items.py <db_path> <category_key> <start_iso> <end_iso>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    target_category = (sys.argv[2] or "").strip().lower()
    start_iso = sys.argv[3]
    end_iso = sys.argv[4]

    if target_category not in ALLOWED_CATEGORIES:
        print(json.dumps({"category": target_category, "topItems": [], "window": {"start": start_iso, "end": end_iso}}))
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT source, app, url, title, classification, category,
               COALESCE(duration_seconds, 0) AS duration_seconds
        FROM events
        WHERE COALESCE(event_timestamp, timestamp) >= ?
          AND COALESCE(event_timestamp, timestamp) <= ?
        """,
        (start_iso, end_iso),
    ).fetchall()
    conn.close()

    totals: dict[tuple[str, str], float] = {}
    counts: dict[tuple[str, str], int] = {}
    for row in rows:
        if _normalize_category(row) != target_category:
            continue
        source = (row["source"] or "").strip().lower()
        if source == "app":
            item_type = "app"
            name = _normalize_app(row["app"] or "", row["title"] or "")
        else:
            item_type = "site"
            name = _normalize_site(row["url"] or "", row["title"] or "")
        key = (item_type, name)
        dur = float(row["duration_seconds"] or 0.0)
        weight = dur if dur > 0 else 1.0
        totals[key] = totals.get(key, 0.0) + weight
        counts[key] = counts.get(key, 0) + 1

    if not totals:
        print(json.dumps({
            "category": target_category,
            "topItems": [],
            "window": {"start": start_iso, "end": end_iso},
        }))
        return

    total_seconds = sum(totals.values()) or 1.0
    top_items = sorted(
        (
            {
                "name": name,
                "type": item_type,
                "durationSeconds": round(seconds, 2),
                "percent": round((seconds / total_seconds) * 100, 1),
                "eventCount": counts[(item_type, name)],
                "formattedTime": _fmt_duration(seconds),
            }
            for (item_type, name), seconds in totals.items()
        ),
        key=lambda x: x["durationSeconds"],
        reverse=True,
    )[:5]

    print(json.dumps({
        "category": target_category,
        "topItems": top_items,
        "window": {"start": start_iso, "end": end_iso},
    }))


if __name__ == "__main__":
    main()
