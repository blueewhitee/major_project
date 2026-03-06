import sqlite3, sys

conn = sqlite3.connect(r'model_server\database\focus_tracker.db')
lines = []

rows = conn.execute("""
    SELECT classification, COUNT(*) as cnt, ROUND(SUM(duration_seconds),1) as total_sec
    FROM events
    WHERE (url LIKE '%overleaf%' OR title LIKE '%overleaf%')
    GROUP BY classification
""").fetchall()
lines.append("OVERLEAF BY CLASSIFICATION:")
for r in rows:
    lines.append(f"  {r[0]} | count={r[1]} | total_seconds={r[2]}")

rows3 = conn.execute("""
    SELECT classification, url, title, duration_seconds, event_timestamp
    FROM events
    WHERE (url LIKE '%overleaf%' OR title LIKE '%overleaf%')
    ORDER BY event_timestamp DESC
""").fetchall()
lines.append("\nALL OVERLEAF EVENTS:")
for r in rows3:
    lines.append(f"  cls={r[0]} dur={round(r[3] or 0,1)}s ts={r[4]} url={str(r[1])[:70]}")

conn.close()

with open("overleaf_debug.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Written to overleaf_debug.txt")
