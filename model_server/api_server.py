from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import sys
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Any
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from testmodel import classify, classify_category, classify_entertainment_trigger  # model loads at import time

# Single lock that serialises all NLI model calls — prevents concurrent
# model access when FastAPI processes requests in multiple threads.
model_lock = threading.Lock()

app = FastAPI(title="Focus Tracker Classifier", version="1.0.0")

DB_FILE = os.path.join(os.path.dirname(__file__), "database", "focus_tracker.db")

# ═══════════════════════════════════════════════════════════════════
#  In-memory LRU + TTL cache for repeated classifications
# ═══════════════════════════════════════════════════════════════════
CACHE_MAX_ITEMS = int(os.getenv("CLASSIFY_CACHE_MAX_ITEMS", "2000"))
CACHE_TTL_SECONDS = int(os.getenv("CLASSIFY_CACHE_TTL_SECONDS", "600"))  # default: 10 min
CACHE_NAMESPACE = os.getenv("CLASSIFY_CACHE_NAMESPACE", "v1")

# key -> (expires_at_monotonic, value)
_classify_cache: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()
cache_lock = threading.Lock()


def _norm_text(value: str, max_len: int) -> str:
    s = (value or "").strip().lower()
    s = " ".join(s.split())
    return s[:max_len]


def _cache_key(stage: str, url: str, title: str, description: str = "") -> str:
    n_url = _norm_text(url, 800)
    n_title = _norm_text(title, 300)
    n_desc = _norm_text(description, 300)
    return f"{CACHE_NAMESPACE}|{stage}|{n_url}|{n_title}|{n_desc}"


def _cache_get(key: str):
    now = time.monotonic()
    with cache_lock:
        item = _classify_cache.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at < now:
            _classify_cache.pop(key, None)
            return None
        _classify_cache.move_to_end(key)
        return value


def _cache_set(key: str, value: Any) -> None:
    with cache_lock:
        _classify_cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, value)
        _classify_cache.move_to_end(key)
        if len(_classify_cache) > CACHE_MAX_ITEMS:
            _classify_cache.popitem(last=False)

# ═══════════════════════════════════════════════════════════════════
#  SQLITE helpers
# ═══════════════════════════════════════════════════════════════════
def _init_sqlite_if_needed() -> None:
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_timestamp TEXT,
                duration_seconds REAL,
                source TEXT,
                app TEXT,
                url TEXT,
                title TEXT,
                description TEXT,
                classification TEXT,
                confidence REAL,
                latency_ms REAL,
                score_productive REAL,
                score_distractive REAL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_classification ON events(classification)"
        )
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(events)").fetchall()
        }
        if "duration_seconds" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN duration_seconds REAL")
        if "event_timestamp" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN event_timestamp TEXT")
        if "category" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN category TEXT")
        if "category_confidence" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN category_confidence REAL")
        if "entertainment_trigger" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN entertainment_trigger TEXT")
        if "trigger_confidence" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN trigger_confidence REAL")
        if "trigger_source" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN trigger_source TEXT")
        if "trigger_latency_ms" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN trigger_latency_ms REAL")


def _log_to_sqlite(url: str, title: str, description: str, result: dict,
                   source: str = "browser", app_name: str = "",
                   duration_seconds: float = 0.0,
                   event_timestamp: str = "",
                   cat_result: dict | None = None,
                   trigger_result: dict | None = None) -> None:
    ts = datetime.now().isoformat(timespec="milliseconds")
    category = cat_result["category"] if cat_result else None
    category_confidence = cat_result["confidence"] if cat_result else None
    entertainment_trigger = trigger_result["trigger"] if trigger_result else None
    trigger_confidence = trigger_result["confidence"] if trigger_result else None
    trigger_source = trigger_result["source"] if trigger_result else None
    trigger_latency_ms = trigger_result["latency_ms"] if trigger_result else None
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            """
            INSERT INTO events (
                timestamp, event_timestamp, duration_seconds, source, app, url, title, description,
                classification, confidence, latency_ms,
                score_productive, score_distractive,
                category, category_confidence,
                entertainment_trigger, trigger_confidence, trigger_source, trigger_latency_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts,
                event_timestamp,
                duration_seconds,
                source,
                app_name,
                url,
                title,
                description,
                result["classification"],
                result["confidence"],
                result["latency_ms"],
                result["raw_scores"]["PRODUCTIVE"],
                result["raw_scores"]["DISTRACTIVE"],
                category,
                category_confidence,
                entertainment_trigger,
                trigger_confidence,
                trigger_source,
                trigger_latency_ms,
            ),
        )
        conn.commit()


# ── Known productive apps (match against lowercased app name) ──────
PRODUCTIVE_APPS = {
    # IDEs / editors
    "cursor", "cursor.exe",
    "code", "code.exe",
    "pycharm64", "pycharm64.exe", "pycharm",
    "webstorm64", "webstorm64.exe",
    "idea64", "idea64.exe",
    "clion64", "clion64.exe", "rider64", "rider64.exe",
    "sublime_text", "sublime_text.exe",
    "notepad++", "notepad++.exe",
    "vim", "nvim", "emacs",
    # Terminals
    "windowsterminal", "windowsterminal.exe", "wt", "wt.exe",
    "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    "cmd", "cmd.exe", "bash", "zsh", "sh",
    "mintty", "alacritty", "kitty", "wezterm",
    # Dev tools
    "postman", "postman.exe",
    "dbeaver", "dbeaver.exe",
    "figma", "figma.exe",
    # Note-taking / docs
    "notion", "notion.exe",
    "obsidian", "obsidian.exe",
    # Office / productivity
    "excel", "excel.exe",
    "winword", "winword.exe",
    "powerpnt", "powerpnt.exe",
    # Communication (work)
    "zoom", "zoom.exe",
    "teams", "teams.exe", "ms-teams.exe",
    "slack", "slack.exe",
}

# ── Known distractive apps ─────────────────────────────────────────
DISTRACTIVE_APPS = {
    "spotify", "spotify.exe",
    "discord", "discord.exe",
    "steam", "steam.exe",
    "epicgameslauncher", "epicgameslauncher.exe",
    "vlc", "vlc.exe",
}


# ── Static category mapping for known apps (skips NLI for category pass) ──
APP_CATEGORY_MAP: dict[str, str] = {
    # IDEs / editors → productivity
    "cursor": "productivity",
    "cursor.exe": "productivity",
    "code": "productivity",
    "code.exe": "productivity",
    "pycharm64": "productivity",
    "pycharm64.exe": "productivity",
    "pycharm": "productivity",
    "webstorm64": "productivity",
    "webstorm64.exe": "productivity",
    "idea64": "productivity",
    "idea64.exe": "productivity",
    "clion64": "productivity",
    "rider64": "productivity",
    "sublime_text": "productivity",
    "notepad++": "productivity",
    "vim": "productivity",
    "nvim": "productivity",
    "emacs": "productivity",
    # Terminals → productivity
    "windowsterminal": "productivity",
    "windowsterminal.exe": "productivity",
    "powershell": "productivity",
    "powershell.exe": "productivity",
    "pwsh": "productivity",
    "cmd": "productivity",
    "bash": "productivity",
    "zsh": "productivity",
    "mintty": "productivity",
    "alacritty": "productivity",
    "wezterm": "productivity",
    # Dev tools → productivity
    "postman": "productivity",
    "dbeaver": "productivity",
    "figma": "productivity",
    # Note-taking / docs → productivity
    "notion": "productivity",
    "obsidian": "productivity",
    "excel": "productivity",
    "winword": "productivity",
    "powerpnt": "productivity",
    # Communication → productivity
    "zoom": "productivity",
    "teams": "productivity",
    "slack": "productivity",
    # Entertainment / distractive apps
    "spotify": "music",
    "spotify.exe": "music",
    "vlc": "entertainment",
    "vlc.exe": "entertainment",
    "discord": "social",
    "discord.exe": "social",
    "steam": "gaming",
    "steam.exe": "gaming",
    "epicgameslauncher": "gaming",
    "epicgameslauncher.exe": "gaming",
}


_init_sqlite_if_needed()


def _log_activity(url: str, title: str, description: str, result: dict,
                  source: str = "browser", app_name: str = "",
                  duration_seconds: float = 0.0,
                  event_timestamp: str = "",
                  cat_result: dict | None = None,
                  trigger_result: dict | None = None) -> None:
    _log_to_sqlite(
        url,
        title,
        description,
        result,
        source=source,
        app_name=app_name,
        duration_seconds=duration_seconds,
        event_timestamp=event_timestamp,
        cat_result=cat_result,
        trigger_result=trigger_result,
    )


# ═══════════════════════════════════════════════════════════════════
#  REQUEST / RESPONSE  models
# ═══════════════════════════════════════════════════════════════════
class ClassifyRequest(BaseModel):
    url: str
    title: str
    description: str = ""
    duration_seconds: float = 0.0
    event_timestamp: str = ""


class ClassifyAppRequest(BaseModel):
    app: str
    title: str
    duration_seconds: float = 0.0
    event_timestamp: str = ""


class ClassifyResponse(BaseModel):
    premise: str
    classification: str       # PRODUCTIVE | DISTRACTIVE | UNCERTAIN
    confidence: float
    latency_ms: float
    raw_scores: dict


# ═══════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/classify", response_model=ClassifyResponse)
def classify_endpoint(req: ClassifyRequest):
    try:
        cls_key = _cache_key("binary", req.url, req.title, req.description)
        cat_key = _cache_key("category", req.url, req.title, req.description)
        trig_key = _cache_key("trigger", req.url, req.title, req.description)

        result = _cache_get(cls_key)
        cat_result = _cache_get(cat_key)
        trigger_result = None

        if result is None:
            with model_lock:
                result = classify(url=req.url, title=req.title, description=req.description)
            _cache_set(cls_key, result)

        if cat_result is None:
            with model_lock:
                cat_result = classify_category(url=req.url, title=req.title, description=req.description)
            _cache_set(cat_key, cat_result)

        if (cat_result.get("category") or "").lower() == "entertainment":
            trigger_result = _cache_get(trig_key)
            if trigger_result is None:
                with model_lock:
                    trigger_result = classify_entertainment_trigger(
                        url=req.url,
                        title=req.title,
                        description=req.description,
                    )
                _cache_set(trig_key, trigger_result)

        _log_activity(
            req.url,
            req.title,
            req.description,
            result,
            source="browser",
            duration_seconds=req.duration_seconds,
            event_timestamp=req.event_timestamp,
            cat_result=cat_result,
            trigger_result=trigger_result,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/classify-app", response_model=ClassifyResponse)
def classify_app_endpoint(req: ClassifyAppRequest):
    try:
        app_lower = req.app.lower().strip()
        premise = (
            f"The user has '{req.app}' open with window title: '{req.title}'."
        )

        if app_lower in PRODUCTIVE_APPS:
            result = {
                "premise":        premise,
                "classification": "PRODUCTIVE",
                "confidence":     1.0,
                "latency_ms":     0.0,
                "raw_scores":     {"PRODUCTIVE": 1.0, "DISTRACTIVE": 0.0},
            }
        elif app_lower in DISTRACTIVE_APPS:
            result = {
                "premise":        premise,
                "classification": "DISTRACTIVE",
                "confidence":     1.0,
                "latency_ms":     0.0,
                "raw_scores":     {"PRODUCTIVE": 0.0, "DISTRACTIVE": 1.0},
            }
        else:
            # Unknown app — let the ML model judge by window title
            app_url = f"app://{app_lower}"
            app_desc = f"Desktop application: {req.app}"
            cls_key = _cache_key("binary-app", app_url, req.title, app_desc)
            result = _cache_get(cls_key)
            if result is None:
                with model_lock:
                    result = classify(
                        url=app_url,
                        title=req.title,
                        description=app_desc,
                    )
                _cache_set(cls_key, result)
            result["premise"] = premise

        # Resolve category: use static map for known apps, NLI for unknown ones
        if app_lower in APP_CATEGORY_MAP:
            cat_result = {
                "category":   APP_CATEGORY_MAP[app_lower],
                "confidence": 1.0,
            }
        else:
            app_url = f"app://{app_lower}"
            app_desc = f"Desktop application: {req.app}"
            cat_key = _cache_key("category-app", app_url, req.title, app_desc)
            cat_result = _cache_get(cat_key)
            if cat_result is None:
                with model_lock:
                    cat_result = classify_category(
                        url=app_url,
                        title=req.title,
                        description=app_desc,
                    )
                _cache_set(cat_key, cat_result)

        _log_activity(
            url=f"app://{app_lower}",
            title=req.title,
            description="",
            result=result,
            source="app",
            app_name=req.app,
            duration_seconds=req.duration_seconds,
            event_timestamp=req.event_timestamp,
            cat_result=cat_result,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=False)
