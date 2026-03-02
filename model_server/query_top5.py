import json
import sqlite3
import sys
from datetime import datetime
from urllib.parse import urlparse


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{round(seconds)}s"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours == 0:
        return f"{minutes}m"
    return f"{hours}h {minutes}m"


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


def _to_display_name(normalized: str) -> str:
    if not normalized:
        return "Unknown"
    return normalized[0].upper() + normalized[1:]


def _percentage_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    max_val = max(r["durationSeconds"] for r in rows) or 1.0
    out = []
    for r in rows:
        pct = int(round((r["durationSeconds"] / max_val) * 100))
        out.append({
            **r,
            "percentage": pct,
            "formattedTime": _fmt_duration(r["durationSeconds"]),
        })
    return out


def main() -> None:
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: query_top5.py <db_path> <start_iso> <end_iso>"}))
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
          AND classification IN ('PRODUCTIVE', 'DISTRACTIVE')
        """,
        (start_iso, end_iso),
    ).fetchall()

    prod_map: dict[str, float] = {}
    dist_map: dict[str, float] = {}
    prod_counts: dict[str, int] = {}
    dist_counts: dict[str, int] = {}
    last_updated = None

    for row in rows:
        ts = row["event_timestamp"] or row["timestamp"]
        if ts and (last_updated is None or ts > last_updated):
            last_updated = ts

        duration = float(row["duration_seconds"] or 0.0)
        weight = duration if duration > 0 else 1.0
        source = (row["source"] or "").strip().lower()

        if source == "browser":
            key = _normalize_browser_name(row["url"] or "", row["title"] or "")
        else:
            key = _normalize_app_name(row["app"] or "", row["title"] or "")

        if row["classification"] == "PRODUCTIVE":
            prod_map[key] = prod_map.get(key, 0.0) + weight
            prod_counts[key] = prod_counts.get(key, 0) + 1
        else:
            dist_map[key] = dist_map.get(key, 0.0) + weight
            dist_counts[key] = dist_counts.get(key, 0) + 1

    productive = sorted(
        (
            {
                "name": _to_display_name(name),
                "durationSeconds": round(seconds, 2),
                "eventCount": prod_counts.get(name, 0),
            }
            for name, seconds in prod_map.items()
        ),
        key=lambda x: x["durationSeconds"],
        reverse=True,
    )[:5]

    distracting = sorted(
        (
            {
                "name": _to_display_name(name),
                "durationSeconds": round(seconds, 2),
                "eventCount": dist_counts.get(name, 0),
            }
            for name, seconds in dist_map.items()
        ),
        key=lambda x: x["durationSeconds"],
        reverse=True,
    )[:5]

    productive = _percentage_rows(productive)
    distracting = _percentage_rows(distracting)

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

    print(json.dumps({
        "productiveTop5": productive,
        "distractingTop5": distracting,
        "lastUpdated": last_updated,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "totalRows": len(rows),
        "stale": stale,
        "staleMinutes": stale_minutes,
        "window": {"start": start_iso, "end": end_iso},
    }))


if __name__ == "__main__":
    main()
