from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import sys
import os
import sqlite3
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from testmodel import classify  # model loads at import time

app = FastAPI(title="Focus Tracker Classifier", version="1.0.0")

DB_FILE = os.path.join(os.path.dirname(__file__), "database", "focus_tracker.db")

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


def _log_to_sqlite(url: str, title: str, description: str, result: dict,
                   source: str = "browser", app_name: str = "",
                   duration_seconds: float = 0.0,
                   event_timestamp: str = "") -> None:
    ts = datetime.now().isoformat(timespec="milliseconds")
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            """
            INSERT INTO events (
                timestamp, event_timestamp, duration_seconds, source, app, url, title, description,
                classification, confidence, latency_ms,
                score_productive, score_distractive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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


_init_sqlite_if_needed()


def _log_activity(url: str, title: str, description: str, result: dict,
                  source: str = "browser", app_name: str = "",
                  duration_seconds: float = 0.0,
                  event_timestamp: str = "") -> None:
    _log_to_sqlite(
        url,
        title,
        description,
        result,
        source=source,
        app_name=app_name,
        duration_seconds=duration_seconds,
        event_timestamp=event_timestamp,
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
        result = classify(url=req.url, title=req.title, description=req.description)
        _log_activity(
            req.url,
            req.title,
            req.description,
            result,
            source="browser",
            duration_seconds=req.duration_seconds,
            event_timestamp=req.event_timestamp,
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
            result = classify(
                url=f"app://{app_lower}",
                title=req.title,
                description=f"Desktop application: {req.app}",
            )
            result["premise"] = premise

        _log_activity(
            url=f"app://{app_lower}",
            title=req.title,
            description="",
            result=result,
            source="app",
            app_name=req.app,
            duration_seconds=req.duration_seconds,
            event_timestamp=req.event_timestamp,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=False)
