"""
Backfill: re-classify existing UNCERTAIN YouTube events in the DB
using the new YouTube-specific thresholds:
  - /shorts/ URLs → DISTRACTIVE (confidence 1.0)
  - Other YouTube URLs → PRODUCTIVE if score_productive >= 0.55, else DISTRACTIVE

Run once after deploying the api_server.py fix.
"""
import sqlite3
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "database", "focus_tracker.db")

YT_PRODUCTIVE_THRESHOLD = 0.55


def is_youtube_shorts(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        p = urlparse(url or "")
        return ("youtube.com" in (p.hostname or "")) and "/shorts/" in (p.path or "")
    except Exception:
        return "/shorts/" in (url or "").lower()


def main():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row

    # Fetch all UNCERTAIN events that came from youtube.com / youtu.be
    rows = conn.execute(
        """
        SELECT id, url, score_productive, score_distractive
        FROM events
        WHERE classification = 'UNCERTAIN'
          AND (url LIKE '%youtube.com%' OR url LIKE '%youtu.be%')
        """
    ).fetchall()

    print(f"Found {len(rows)} UNCERTAIN YouTube events to backfill...")

    updated_distractive = 0
    updated_productive  = 0

    for row in rows:
        event_id = row["id"]
        url      = row["url"] or ""
        p_score  = float(row["score_productive"]  or 0.0)
        d_score  = float(row["score_distractive"] or 0.0)

        if is_youtube_shorts(url):
            new_cls  = "DISTRACTIVE"
            new_conf = 1.0
            updated_distractive += 1
        elif p_score >= YT_PRODUCTIVE_THRESHOLD:
            new_cls  = "PRODUCTIVE"
            new_conf = round(p_score, 3)
            updated_productive += 1
        else:
            new_cls  = "DISTRACTIVE"
            new_conf = round(d_score, 3)
            updated_distractive += 1

        conn.execute(
            "UPDATE events SET classification = ?, confidence = ? WHERE id = ?",
            (new_cls, new_conf, event_id),
        )

    conn.commit()
    conn.close()

    total = updated_distractive + updated_productive
    print(f"Done. Updated {total} events:")
    print(f"  → DISTRACTIVE : {updated_distractive}")
    print(f"  → PRODUCTIVE  : {updated_productive}")


if __name__ == "__main__":
    main()
