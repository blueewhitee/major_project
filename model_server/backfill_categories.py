"""
backfill_categories.py

Retroactively adds category + category_confidence to all events
that were classified before the category column existed.

Usage:
    py -3 backfill_categories.py

Requires the model files at C:/focus_tracker/ — does NOT need
the api_server.py to be running.
"""
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from testmodel import classify_category  # loads the ONNX model

DB_FILE = os.path.join(os.path.dirname(__file__), "database", "focus_tracker.db")


def main() -> None:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row

    # ── Ensure columns exist ──────────────────────────────────────
    cols = {row[1] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
    if "category" not in cols:
        conn.execute("ALTER TABLE events ADD COLUMN category TEXT")
        conn.commit()
        print("  Added 'category' column.")
    if "category_confidence" not in cols:
        conn.execute("ALTER TABLE events ADD COLUMN category_confidence REAL")
        conn.commit()
        print("  Added 'category_confidence' column.")

    # ── Find rows that still need categorising ────────────────────
    rows = conn.execute(
        """
        SELECT id, source, url, app, title, description
        FROM events
        WHERE category IS NULL OR category = ''
        ORDER BY COALESCE(event_timestamp, timestamp) ASC
        """
    ).fetchall()

    total = len(rows)
    if total == 0:
        print("Nothing to backfill — all events already have a category.")
        conn.close()
        return

    print(f"Backfilling {total} events...\n")
    t_start = time.perf_counter()

    done = 0
    errors = 0

    for row in rows:
        row_id   = row["id"]
        source   = (row["source"] or "").strip().lower()
        url      = row["url"]   or ""
        app_name = row["app"]   or ""
        title    = row["title"] or ""
        desc     = row["description"] or ""

        # Build inputs the same way the API does
        if source == "app":
            infer_url  = f"app://{app_name.lower().strip()}" if app_name else url
            infer_desc = f"Desktop application: {app_name}"
        else:
            infer_url  = url
            infer_desc = desc

        try:
            result = classify_category(infer_url, title, infer_desc)
            conn.execute(
                "UPDATE events SET category = ?, category_confidence = ? WHERE id = ?",
                (result["category"], result["confidence"], row_id),
            )
            done += 1

            # Commit in batches of 50 to avoid holding a huge transaction
            if done % 50 == 0:
                conn.commit()
                elapsed = time.perf_counter() - t_start
                rate = done / elapsed
                remaining = (total - done) / rate if rate > 0 else 0
                print(
                    f"  {done}/{total}  "
                    f"({done/total*100:.0f}%)  "
                    f"~{remaining:.0f}s remaining"
                )

        except Exception as exc:
            errors += 1
            print(f"  [WARN] row {row_id} failed: {exc}")

    conn.commit()
    conn.close()

    elapsed = time.perf_counter() - t_start
    print(
        f"\nDone: {done} categorised, {errors} errors, "
        f"{elapsed:.1f}s total ({elapsed/max(done,1)*1000:.0f} ms/event avg)"
    )


if __name__ == "__main__":
    main()
