import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

AW_BASE = "http://localhost:5600/api/0"
HOST = "ASHU"
BROWSER_BUCKET = f"aw-watcher-web-chrome_{HOST}"
CLASSIFY_URL = "http://127.0.0.1:8000/classify"
CLASSIFY_APP_URL = "http://127.0.0.1:8000/classify-app"
DB_FILE = "E:/major/poc3/model_server/database/focus_tracker.db"

MIN_DURATION = 2.0
SKIP_APPS = {
    "explorer", "explorer.exe",
    "searchhost", "searchhost.exe",
    "applicationframehost", "applicationframehost.exe",
    "shellexperiencehost", "shellexperiencehost.exe",
    "startmenuexperiencehost", "startmenuexperiencehost.exe",
    "textinputhost", "textinputhost.exe",
    "lockapp", "lockapp.exe",
    "dwm", "dwm.exe",
    "systemsettings", "systemsettings.exe",
    "taskmgr", "taskmgr.exe",
    "chrome", "chrome.exe",
    "msedge", "msedge.exe",
    "firefox", "firefox.exe",
    "brave", "brave.exe",
    "opera", "opera.exe",
}


def _build_browser_description(url: str, title: str, data: dict) -> str:
    parts = []
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        host = ""

    if "youtube.com" in host or "youtu.be" in host:
        content_type = "video"
        if "/shorts/" in url:
            content_type = "short-form video"
        elif "/watch" in url:
            content_type = "long-form video"
        elif "/feed/" in url:
            content_type = "feed/browsing page"
        parts.append(f"YouTube {content_type}.")
    elif host:
        parts.append(f"Website host: {host}.")

    if data.get("audible"):
        parts.append("Tab is currently audible.")
    if title:
        parts.append(f"Window title: {title[:180]}.")
    return " ".join(parts).strip()


def _find_window_bucket() -> str | None:
    resp = requests.get(f"{AW_BASE}/buckets", timeout=10)
    resp.raise_for_status()
    for bucket_id in resp.json().keys():
        if bucket_id.startswith("aw-watcher-window"):
            return bucket_id
    return None


def _fetch_events(bucket_id: str, start_iso_utc: str) -> list[dict]:
    resp = requests.get(
        f"{AW_BASE}/buckets/{bucket_id}/events",
        params={"start": start_iso_utc, "limit": 200000},
        timeout=30,
    )
    resp.raise_for_status()
    return list(reversed(resp.json()))


def _load_existing_keys() -> set[tuple]:
    conn = sqlite3.connect(DB_FILE)
    rows = conn.execute(
        """
        SELECT COALESCE(event_timestamp, ''), COALESCE(source, ''), COALESCE(url, ''),
               COALESCE(app, ''), COALESCE(title, ''), COALESCE(duration_seconds, 0)
        FROM events
        """
    ).fetchall()
    conn.close()
    return {(r[0], r[1], r[2], r[3], r[4], round(float(r[5] or 0), 3)) for r in rows}


def main() -> None:
    today_local = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = today_local.astimezone(timezone.utc).isoformat()

    window_bucket = _find_window_bucket()
    web_events = _fetch_events(BROWSER_BUCKET, start_utc)
    app_events = _fetch_events(window_bucket, start_utc) if window_bucket else []

    existing = _load_existing_keys()
    posted_web = 0
    posted_app = 0
    skipped_dupe = 0

    for event in web_events:
        duration = float(event.get("duration", 0) or 0)
        data = event.get("data", {})
        url = (data.get("url") or "").strip()
        title = (data.get("title") or "").strip()
        event_ts = event.get("timestamp", "")
        if not url or not title or duration < MIN_DURATION or data.get("incognito"):
            continue

        key = (event_ts, "browser", url, "", title, round(duration, 3))
        if key in existing:
            skipped_dupe += 1
            continue

        payload = {
            "url": url,
            "title": title,
            "description": _build_browser_description(url, title, data),
            "duration_seconds": duration,
            "event_timestamp": event_ts,
        }
        resp = requests.post(CLASSIFY_URL, json=payload, timeout=30)
        resp.raise_for_status()
        existing.add(key)
        posted_web += 1

    for event in app_events:
        duration = float(event.get("duration", 0) or 0)
        data = event.get("data", {})
        app_name = (data.get("app") or "").strip()
        title = (data.get("title") or "").strip()
        event_ts = event.get("timestamp", "")
        if not app_name or not title or duration < MIN_DURATION:
            continue
        if app_name.lower() in SKIP_APPS:
            continue

        key = (event_ts, "app", f"app://{app_name.lower().strip()}", app_name, title, round(duration, 3))
        if key in existing:
            skipped_dupe += 1
            continue

        payload = {
            "app": app_name,
            "title": title,
            "duration_seconds": duration,
            "event_timestamp": event_ts,
        }
        resp = requests.post(CLASSIFY_APP_URL, json=payload, timeout=30)
        resp.raise_for_status()
        existing.add(key)
        posted_app += 1

    print(
        f"Backfill complete: web_posted={posted_web}, app_posted={posted_app}, "
        f"skipped_duplicates={skipped_dupe}, since_local_midnight={today_local.isoformat()}"
    )


if __name__ == "__main__":
    main()
