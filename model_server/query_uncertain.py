import json
import sqlite3
import sys
from datetime import datetime
from urllib.parse import urlparse


def _normalize_browser_name(url: str, title: str) -> str:
    if url:
        try:
            host = urlparse(url).hostname or ""
            host = host.lower().strip()
            if host.startswith("www."):
                host = host[4:]
            if host:
                return host
        except Exception:
            pass
    if title:
        return title.strip().lower()[:80]
    return "unknown"


def _normalize_app_name(app_name: str, title: str) -> str:
    name = (app_name or "").strip().lower()
    if name.startswith("app://"):
        name = name[6:]
    if name.endswith(".exe"):
        name = name[:-4]
    if name:
        return name
    if title:
        return title.strip().lower()[:80]
    return "unknown"


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{round(seconds)}s"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours == 0:
        return f"{minutes}m"
    return f"{hours}h {minutes}m"


def main() -> None:
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: query_uncertain.py <db_path> <start_iso> <end_iso>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    start_iso = sys.argv[2]
    end_iso = sys.argv[3]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT timestamp, event_timestamp, classification, source, app, url, title,
               COALESCE(duration_seconds, 0) AS duration_seconds
        FROM events
        WHERE COALESCE(event_timestamp, timestamp) >= ? AND COALESCE(event_timestamp, timestamp) <= ?
          AND classification = 'UNCERTAIN'
        """,
        (start_iso, end_iso),
    ).fetchall()

    uncertain_map: dict[str, float] = {}
    
    for row in rows:
        duration = float(row["duration_seconds"] or 0.0)
        source = (row["source"] or "").strip().lower()

        if source == "browser":
            key = _normalize_browser_name(row["url"] or "", row["title"] or "")
        else:
            key = _normalize_app_name(row["app"] or "", row["title"] or "")

        uncertain_map[key] = uncertain_map.get(key, 0.0) + duration

    # Filter to > 30 mins (1800 seconds)
    results = []
    for key, duration in uncertain_map.items():
        if duration >= 1800:
             results.append({
                 "key": key,
                 "durationSeconds": duration,
                 "formattedTime": _fmt_duration(duration),
             })
             
    results.sort(key=lambda x: x["durationSeconds"], reverse=True)

    print(json.dumps({
        "uncertainItems": results,
    }))


if __name__ == "__main__":
    main()
