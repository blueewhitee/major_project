import json
import sqlite3
import sys
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


def main() -> None:
    if len(sys.argv) < 6:
        print(json.dumps({"error": "usage: apply_override.py <db_path> <key> <classification> <start_iso> <end_iso>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    target_key = sys.argv[2]
    classification = sys.argv[3]
    start_iso = sys.argv[4]
    end_iso = sys.argv[5]

    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 1. Insert into overrides
            cursor.execute(
                "INSERT OR REPLACE INTO user_overrides (key, classification) VALUES (?, ?)",
                (target_key, classification)
            )

            # 2. Update existing events today to make the dashboard instantly reflect this
            rows = cursor.execute(
                """
                SELECT id, source, app, url, title
                FROM events
                WHERE COALESCE(event_timestamp, timestamp) >= ? AND COALESCE(event_timestamp, timestamp) <= ?
                """,
                (start_iso, end_iso)
            ).fetchall()

            updates = 0
            for row in rows:
                source = (row["source"] or "").strip().lower()
                if source == "browser":
                    k = _normalize_browser_name(row["url"], row["title"])
                else:
                    k = _normalize_app_name(row["app"], row["title"])
                
                if k == target_key:
                    cursor.execute(
                        "UPDATE events SET classification = ?, confidence = 1.0 WHERE id = ?",
                        (classification, row["id"])
                    )
                    updates += 1

            conn.commit()

            print(json.dumps({"success": True, "updated_events": updates}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
