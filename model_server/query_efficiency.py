import json
import sqlite3
import sys
from datetime import datetime, timedelta


def _parse_ts(ts: str) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _hour_label(hour: int) -> str:
    start = datetime(2000, 1, 1, hour, 0)
    end = datetime(2000, 1, 1, (hour + 1) % 24, 0)
    return f"{start.strftime('%I %p').lstrip('0')} - {end.strftime('%I %p').lstrip('0')}"


def _distribute(
    dt: datetime,
    duration: float,
    classification: str,
    productive_by_hour: dict[int, float],
    distracting_by_hour: dict[int, float],
) -> None:
    """Split an event's duration proportionally across the hours it spans."""
    if duration <= 0:
        duration = 1.0

    event_end = dt + timedelta(seconds=duration)
    cursor = dt

    while cursor < event_end:
        # End of the current hour
        next_hour = (cursor + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        slice_end = min(next_hour, event_end)
        slice_secs = (slice_end - cursor).total_seconds()
        h = cursor.hour

        if classification == "PRODUCTIVE":
            productive_by_hour[h] += slice_secs
        else:
            distracting_by_hour[h] += slice_secs

        cursor = next_hour


def main() -> None:
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: query_efficiency.py <db_path> <start_iso> <end_iso>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    start_iso = sys.argv[2]
    end_iso = sys.argv[3]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT
          COALESCE(event_timestamp, timestamp) AS effective_ts,
          classification,
          COALESCE(duration_seconds, 0) AS duration_seconds
        FROM events
        WHERE COALESCE(event_timestamp, timestamp) >= ?
          AND COALESCE(event_timestamp, timestamp) <= ?
          AND classification IN ('PRODUCTIVE', 'DISTRACTIVE')
        """,
        (start_iso, end_iso),
    ).fetchall()
    conn.close()

    productive_by_hour: dict[int, float] = {h: 0.0 for h in range(24)}
    distracting_by_hour: dict[int, float] = {h: 0.0 for h in range(24)}

    for row in rows:
        dt = _parse_ts(row["effective_ts"])
        if dt is None:
            continue
        duration = float(row["duration_seconds"] or 0.0)
        _distribute(dt, duration, row["classification"], productive_by_hour, distracting_by_hour)

    # Only consider hours with meaningful activity (>= 30s total)
    active_hours = {
        h for h in range(24) if productive_by_hour[h] + distracting_by_hour[h] >= 30
    }

    if not active_hours:
        print(json.dumps({
            "mostProductive": "N/A",
            "mostDistracting": "N/A",
            "focusPeakPercent": 0,
            "focusPeakHour": "N/A",
            "sampleSize": len(rows),
        }))
        return

    most_productive_hour = max(active_hours, key=lambda h: productive_by_hour[h])
    most_distracting_hour = max(active_hours, key=lambda h: distracting_by_hour[h])

    best_focus_hour = 0
    best_focus_percent = 0
    # Focus peak: highest focus % among hours with >= 5 min total activity
    for h in active_hours:
        p = productive_by_hour[h]
        d = distracting_by_hour[h]
        total = p + d
        if total < 300:  # need at least 5 min for a meaningful peak
            continue
        percent = int(round((p / total) * 100))
        if percent > best_focus_percent or (percent == best_focus_percent and total > productive_by_hour[best_focus_hour] + distracting_by_hour[best_focus_hour]):
            best_focus_percent = percent
            best_focus_hour = h

    print(
        json.dumps(
            {
                "mostProductive": _hour_label(most_productive_hour),
                "mostDistracting": _hour_label(most_distracting_hour),
                "focusPeakPercent": best_focus_percent,
                "focusPeakHour": datetime(2000, 1, 1, best_focus_hour, 0).strftime("%I %p").lstrip("0"),
                "sampleSize": len(rows),
            }
        )
    )


if __name__ == "__main__":
    main()
