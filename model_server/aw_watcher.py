import time
import json
import os
import requests
from datetime import datetime, timezone
from urllib.parse import urlparse
import re

# ═══════════════════════════════════════════════════════════════════
#  CONFIG
# ═══════════════════════════════════════════════════════════════════
AW_BASE          = "http://localhost:5600"
BROWSER_BUCKET   = "aw-watcher-web-chrome_ASHU"
CLASSIFY_URL     = "http://127.0.0.1:8000/classify"
CLASSIFY_APP_URL = "http://127.0.0.1:8000/classify-app"
STATE_FILE       = "C:/focus_tracker/aw_state.json"

POLL_INTERVAL  = 10    # seconds between polls
MIN_DURATION   = 2.0   # skip events shorter than this (seconds)
STARTUP_DELAY  = 60    # seconds to wait on launch (lets model server fully load)

# Search-engine result pages — no meaningful activity signal.
# Format: (exact_hostname, path_prefix). Subdomains are NOT matched.
SKIP_URL_PATTERNS: list[tuple[str, str]] = [
    ("www.google.com",    "/search"),
    ("www.bing.com",      "/search"),
    ("search.brave.com",  "/search"),
    ("duckduckgo.com",    "/"),        # DDG is search-only; all pages are results
]

# System/OS processes that are meaningless to track
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
    # Browsers are already tracked through the browser bucket
    "chrome", "chrome.exe",
    "msedge", "msedge.exe",
    "firefox", "firefox.exe",
    "brave", "brave.exe",
    "opera", "opera.exe",
}


def _should_skip_url(url: str) -> bool:
    """Return True if this URL should be silently dropped (no classify, no DB write)."""
    try:
        p = urlparse(url)
        host = (p.hostname or "").lower()
        for skip_host, skip_path in SKIP_URL_PATTERNS:
            if host == skip_host and p.path.startswith(skip_path):
                return True
    except Exception:
        pass
    return False


# ═══════════════════════════════════════════════════════════════════
#  STATE  (persists last-processed position across restarts)
# ═══════════════════════════════════════════════════════════════════
def load_state() -> dict:
    if os.path.isfile(STATE_FILE):
        state = {}
        with open(STATE_FILE, encoding="utf-8") as f:
            state = json.load(f)
        # Backfill new keys for older state files
        if "last_timestamp_window" not in state:
            state["last_timestamp_window"] = state.get("last_timestamp",
                                                        datetime.now(timezone.utc).isoformat())
            state["last_id_window"] = None
        return state
    now = datetime.now(timezone.utc).isoformat()
    return {
        "last_timestamp":        now,
        "last_id":               None,
        "last_timestamp_window": now,
        "last_id_window":        None,
    }


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


# ═══════════════════════════════════════════════════════════════════
#  ACTIVITYWATCH  helpers
# ═══════════════════════════════════════════════════════════════════
def find_window_bucket() -> str | None:
    """Return the aw-watcher-window bucket ID, or None if not found."""
    try:
        resp = requests.get(f"{AW_BASE}/api/0/buckets", timeout=5)
        resp.raise_for_status()
        for bucket_id in resp.json():
            if bucket_id.startswith("aw-watcher-window"):
                return bucket_id
    except Exception:
        pass
    return None


def fetch_events(bucket_id: str, start_timestamp: str) -> list:
    resp = requests.get(
        f"{AW_BASE}/api/0/buckets/{bucket_id}/events",
        params={"limit": 100, "start": start_timestamp},
        timeout=5,
    )
    resp.raise_for_status()
    # AW returns newest-first; reverse to process in chronological order
    return list(reversed(resp.json()))


# ═══════════════════════════════════════════════════════════════════
#  CLASSIFY  helpers
# ═══════════════════════════════════════════════════════════════════
def classify_browser_event(event: dict) -> dict | None:
    data  = event.get("data", {})
    url   = data.get("url", "").strip()
    title = data.get("title", "").strip()
    duration = float(event.get("duration", 0))
    event_timestamp = event.get("timestamp", "")
    if not url or not title:
        return None
    if _should_skip_url(url):
        return None
    description = _build_browser_description(url, title, data)
    resp = requests.post(
        CLASSIFY_URL,
        json={
            "url": url,
            "title": title,
            "description": description,
            "duration_seconds": duration,
            "event_timestamp": event_timestamp,
            "event_id": event.get("id"),
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def classify_app_event(event: dict) -> dict | None:
    data  = event.get("data", {})
    app   = data.get("app", "").strip()
    title = data.get("title", "").strip()
    duration = float(event.get("duration", 0))
    event_timestamp = event.get("timestamp", "")
    if not app or not title:
        return None
    resp = requests.post(
        CLASSIFY_APP_URL,
        json={
            "app": app,
            "title": title,
            "duration_seconds": duration,
            "event_timestamp": event_timestamp,
            "event_id": event.get("id"),
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "your", "you",
    "are", "was", "were", "have", "has", "how", "what", "when", "why",
    "new", "home", "page", "watch", "video", "shorts", "feed", "official",
}


def _title_keywords(title: str, max_words: int = 5) -> str:
    words = re.findall(r"[a-zA-Z0-9]{3,}", (title or "").lower())
    unique: list[str] = []
    for word in words:
        if word in _STOPWORDS:
            continue
        if word not in unique:
            unique.append(word)
        if len(unique) >= max_words:
            break
    return ", ".join(unique)


def _infer_content_type(host: str, path: str) -> tuple[str, str]:
    host = host.lower()
    path = path.lower()
    if "youtube.com" in host or "youtu.be" in host:
        if "/shorts/" in path:
            return "short-form video", "entertainment"
        if "/watch" in path:
            return "long-form video", "learning_or_entertainment"
        return "video browsing page", "entertainment"
    if "reddit.com" in host:
        return "forum thread", "discussion"
    if "github.com" in host or "stackoverflow.com" in host:
        return "technical reference", "learning"
    if any(news in host for news in ("bbc.", "cnn.", "reuters.", "ndtv.", "nytimes.", "thehindu.")):
        return "news article", "news"
    if any(shop in host for shop in ("amazon.", "flipkart.", "myntra.", "ebay.")):
        return "product/review page", "shopping"
    if "wikipedia.org" in host:
        return "reference article", "learning"
    return "web page", "unknown"


def _build_browser_description(url: str, title: str, data: dict) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = (parsed.path or "").lower()
    query = (parsed.query or "").lower()
    keywords = _title_keywords(title)
    content_type, intent = _infer_content_type(host, path)

    hints: list[str] = []
    if "/tutorial" in path or "tutorial" in query:
        hints.append("tutorial")
    if "/course" in path or "course" in query:
        hints.append("course")
    if "/news" in path:
        hints.append("news")
    if "/review" in path or "review" in query:
        hints.append("review")
    if "/r/" in path:
        hints.append("community")

    parts = [
        f"Platform: {host or 'unknown'}.",
        f"Content type: {content_type}.",
        f"Likely intent: {intent}.",
    ]
    if hints:
        parts.append(f"URL hints: {', '.join(hints[:4])}.")
    if data.get("audible"):
        parts.append("Tab is currently audible.")
    if title:
        parts.append(f"Window title: {title[:180]}.")
    if keywords:
        parts.append(f"Title keywords: {keywords}.")
    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════
#  POLL  helpers
# ═══════════════════════════════════════════════════════════════════
_known_durations = {}


def poll_browser(state: dict) -> tuple[int, int]:
    """Fetch and classify new browser events. Returns (classified, skipped)."""
    events   = fetch_events(BROWSER_BUCKET, state["last_timestamp"])
    classified = skipped = 0

    for i, event in enumerate(events):
        event_id = event.get("id")
        duration = event.get("duration", 0)
        data     = event.get("data", {})

        state["last_timestamp"] = event["timestamp"]

        prev_dur = _known_durations.get(("browser", event_id), -1)
        if duration <= prev_dur:
            continue

        if duration < MIN_DURATION:
            skipped += 1
            continue
        if data.get("incognito"):
            skipped += 1
            continue

        _known_durations[("browser", event_id)] = duration

        result = classify_browser_event(event)
        if result:
            classified += 1
            label = result["classification"]
            conf  = result["confidence"]
            title = data.get("title", "")[:50]
            ts    = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] [WEB] {label:<12}  {conf:.0%}  {title}")

    return classified, skipped


def poll_apps(state: dict, window_bucket: str) -> tuple[int, int]:
    """Fetch and classify new app-window events. Returns (classified, skipped)."""
    events  = fetch_events(window_bucket, state["last_timestamp_window"])
    classified = skipped = 0

    for event in events:
        event_id = event.get("id")
        duration = event.get("duration", 0)
        data     = event.get("data", {})
        app_name = data.get("app", "").strip()

        state["last_timestamp_window"] = event["timestamp"]

        prev_dur = _known_durations.get(("app", event_id), -1)
        if duration <= prev_dur:
            continue

        if duration < MIN_DURATION:
            skipped += 1
            continue
        if app_name.lower() in SKIP_APPS:
            skipped += 1
            continue

        _known_durations[("app", event_id)] = duration

        result = classify_app_event(event)
        if result:
            classified += 1
            label       = result["classification"]
            conf        = result["confidence"]
            app_display = app_name[:20]
            ts          = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] [APP] {label:<12}  {conf:.0%}  {app_display}")

    return classified, skipped


# ═══════════════════════════════════════════════════════════════════
#  MAIN LOOP
# ═══════════════════════════════════════════════════════════════════
def main():
    state = load_state()
    save_state(state)

    print(f"AW Watcher starting — browser bucket: {BROWSER_BUCKET}")
    print(f"Waiting {STARTUP_DELAY}s for model server to be ready...\n")
    time.sleep(STARTUP_DELAY)

    window_bucket = find_window_bucket()
    if window_bucket:
        print(f"Window bucket found: {window_bucket}")
    else:
        print("Warning: no aw-watcher-window bucket found. App tracking disabled.")
    print(f"Polling every {POLL_INTERVAL}s\n")

    while True:
        try:
            b_cls, b_skip = poll_browser(state)
            a_cls, a_skip = 0, 0

            if window_bucket:
                try:
                    a_cls, a_skip = poll_apps(state, window_bucket)
                except Exception as exc:
                    ts = datetime.now().strftime("%H:%M:%S")
                    print(f"  [{ts}] App poll error: {exc}")

            save_state(state)

            total_cls  = b_cls + a_cls
            total_skip = b_skip + a_skip
            if total_cls or total_skip:
                print(f"  -> {total_cls} classified | {total_skip} skipped\n")

        except requests.exceptions.ConnectionError:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] Connection error — AW or model server unreachable. Retrying...\n")
        except Exception as exc:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] Error: {exc}\n")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
