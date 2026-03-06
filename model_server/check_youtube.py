import sqlite3

conn = sqlite3.connect("database/focus_tracker.db")
rows = conn.execute(
    """
    SELECT classification, source, url, title, duration_seconds, event_timestamp
    FROM events
    WHERE url LIKE '%youtube%'
    ORDER BY event_timestamp DESC
    LIMIT 20
    """
).fetchall()

print(f"{'Classification':<14} {'Duration':>8}  {'Timestamp':<25}  URL/Title")
print("-" * 100)
for r in rows:
    cls, src, url, title, dur, ts = r
    display = (url or title or "")[:60]
    print(f"{cls or '?':<14} {(dur or 0):>8.1f}s  {(ts or ''):<25}  {display}")

print(f"\nTotal YouTube events: {len(rows)}")

# Also show breakdown by classification
summary = conn.execute(
    "SELECT classification, COUNT(*), SUM(duration_seconds) FROM events WHERE url LIKE '%youtube%' GROUP BY classification"
).fetchall()
print("\nClassification breakdown:")
for s in summary:
    print(f"  {s[0]}: {s[1]} events, {(s[2] or 0):.1f}s total")
