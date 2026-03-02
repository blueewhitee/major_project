# Focus Journal — Personal Productivity Dashboard

A local, privacy-first productivity tracker for Windows. It reads screen-time events from ActivityWatch, classifies every browser tab and desktop app as **Productive**, **Distracting**, or **Uncertain** using an on-device ONNX ML model, persists results to SQLite, and displays a minimal real-time dashboard.

---

## How It Works

```
ActivityWatch (localhost:5600)
        │  browser + window events every 10 s
        ▼
  aw_watcher.py  ──────────────────────────────────────────────────────────
        │  Skips: short events (<2s), incognito, search result pages,      │
        │         system OS processes                                       │
        ├── browser event → POST /classify   (url, title, description)     │
        └── app event     → POST /classify-app (app, title)                │
                │                                                           │
                ▼                                                           │
        api_server.py  (FastAPI, port 8000)                                │
                │  Rule-based fast-path for known apps                     │
                └── Unknown → ONNX zero-shot NLI model (testmodel.py)     │
                        │  "PRODUCTIVE" | "DISTRACTIVE" | "UNCERTAIN"      │
                        ▼                                                   │
                SQLite  →  model_server/database/focus_tracker.db ─────────┘

Dashboard (Next.js, port 3000)
        ├── Focus Meter       ← ActivityWatch live query
        ├── Activity Breakdown← SQLite via query_top5.py
        ├── Efficiency Insights← SQLite via query_efficiency.py
        └── Day-at-a-Glance  ← ActivityWatch live query
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** | |
| **pnpm** | `npm install -g pnpm` |
| **Python 3.13** | Must be accessible as `py` (Windows Launcher) |
| **ActivityWatch** | Running on `http://localhost:5600` — [activitywatch.net](https://activitywatch.net) |
| **aw-watcher-web-chrome** | Chrome extension for browser URL/title events |
| **ONNX model files** | Placed at `C:/focus_tracker/` (see below) |

### Python packages

```bash
pip install fastapi uvicorn pydantic requests optimum[onnxruntime] transformers
```

### ONNX model files

The classifier uses a quantized zero-shot NLI model. Place the following at `C:/focus_tracker/`:

```
C:/focus_tracker/
├── onnx/
│   └── model_quint8_avx2.onnx
├── tokenizer_config.json
├── tokenizer.json
├── special_tokens_map.json
└── (other HuggingFace tokenizer files)
```

> The state file (`aw_state.json`) is also written here by the watcher daemon.

---

## Setup

### 1. Clone and install frontend dependencies

```bash
git clone <repo-url>
cd poc3
pnpm install
```

### 2. Configure environment variables

Copy `.env.local.example` to `.env.local` (or create it):

```bash
# ActivityWatch server URL (server-side only)
ACTIVITYWATCH_URL=http://localhost:5600/api/0

# Your machine's host ID — used to find AW bucket names
# (aw-watcher-window_<HOST>, aw-watcher-web-chrome_<HOST>)
NEXT_PUBLIC_ACTIVITYWATCH_HOST=YOUR_HOSTNAME
```

Find your host ID in the ActivityWatch web UI at `http://localhost:5600` under Buckets.

### 3. Update hardcoded paths (new machine only)

A few paths in `model_server/` point to this machine's layout. Edit them if your setup differs:

| File | Variable | Default |
|---|---|---|
| `testmodel.py` | `MODEL_DIR` | `C:/focus_tracker` |
| `aw_watcher.py` | `STATE_FILE` | `C:/focus_tracker/aw_state.json` |
| `aw_watcher.py` | `BROWSER_BUCKET` | `aw-watcher-web-chrome_ASHU` |
| `backfill_today.py` | `DB_FILE`, `BROWSER_BUCKET` | hardcoded paths |

### 4. (Optional) Register autostart on Windows login

Run once as **Administrator**:

```
model_server\setup_autostart.bat
```

This registers a Task Scheduler entry (`FocusTrackerServer`) that launches the ML server silently at every login. To remove it: open `taskschd.msc` and delete `FocusTrackerServer`.

---

## Running

Start all three services (each in a separate terminal, or use the bat files):

### ML Classification Server

```bash
python model_server/api_server.py
# or
model_server\run_server.bat     # logs → model_server/server.log
```

Listens on `http://localhost:8000`. The ONNX model loads at startup (~5 s warm-up).

### ActivityWatch Watcher Daemon

```bash
python model_server/aw_watcher.py
# or
model_server\run_aw_watcher.bat  # logs → model_server/aw_watcher.log
```

Waits 60 seconds on first start (lets the ML server finish loading), then polls ActivityWatch every 10 seconds.

### Next.js Dashboard

```bash
pnpm dev          # development  →  http://localhost:3000
pnpm build && pnpm start   # production
```

---

## Utilities

### Backfill today's data

If the watcher was offline for part of the day, re-classify everything from midnight:

```bash
python model_server/backfill_today.py
```

Deduplicates against existing DB rows — safe to run multiple times.

### Test the ML model

```bash
python model_server/testmodel.py
```

Runs 14 built-in test cases, then opens an interactive URL/title prompt so you can test the model directly.

---

## Project Structure

```
poc3/
├── app/
│   ├── page.tsx                        # Dashboard page
│   └── api/
│       ├── aw/[...path]/route.ts       # Proxy → ActivityWatch (CORS fix)
│       └── activity/
│           ├── focus-today/route.ts
│           ├── top-5/route.ts          # Spawns query_top5.py
│           ├── efficiency-insights/route.ts  # Spawns query_efficiency.py
│           └── last-12h/route.ts
├── components/
│   ├── focus-overview.tsx              # Focus Meter widget
│   ├── activity-breakdown.tsx          # Top-5 productive / distracting
│   ├── efficiency-insights.tsx         # Most productive hour, focus peak
│   └── productivity-timeline.tsx       # Day-at-a-Glance heatmap
├── lib/
│   └── activitywatch.ts               # AW API client + helpers
├── model_server/
│   ├── api_server.py                  # FastAPI classification server
│   ├── testmodel.py                   # ONNX model loader + classify()
│   ├── aw_watcher.py                  # Polling daemon
│   ├── query_top5.py                  # CLI: top-5 aggregation from SQLite
│   ├── query_efficiency.py            # CLI: hourly efficiency analysis
│   ├── backfill_today.py              # One-shot historical backfill
│   ├── run_server.bat
│   ├── run_aw_watcher.bat
│   ├── setup_autostart.bat
│   └── database/                      # gitignored — created at runtime
│       └── focus_tracker.db
└── .env.local                         # AW URL + host ID (not committed)
```

---

## Dashboard Widgets

| Widget | Data Source | Refresh |
|---|---|---|
| Focus Meter | ActivityWatch live query | Every 5 min |
| Activity Breakdown (Top-5) | SQLite → `query_top5.py` | Every 30 s |
| Efficiency Insights | SQLite → `query_efficiency.py` | Every 30 s |
| Day-at-a-Glance | ActivityWatch live query | On load |

The Activity Breakdown supports **Today** (00:00 → now) and **7 Days** time windows, switchable in the UI.

---

## URL Skip List

Search engine result pages are never classified or stored. The current skip list (configurable in `aw_watcher.py` under `SKIP_URL_PATTERNS`):

- `www.google.com/search` — Google SERP (subdomains like `gemini.google.com` are kept)
- `www.bing.com/search`
- `search.brave.com/search`
- `duckduckgo.com/` — entire domain (search-only site)

---

## SQLite Schema

**Table: `events`**

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key |
| `timestamp` | TEXT | When the classifier processed this event (local ISO) |
| `event_timestamp` | TEXT | Original ActivityWatch event timestamp (UTC) |
| `duration_seconds` | REAL | Time spent on this page / app |
| `source` | TEXT | `browser` or `app` |
| `app` | TEXT | Desktop app name |
| `url` | TEXT | Browser URL or `app://appname` |
| `title` | TEXT | Window title |
| `description` | TEXT | Context string sent to the ML model |
| `classification` | TEXT | `PRODUCTIVE`, `DISTRACTIVE`, or `UNCERTAIN` |
| `confidence` | REAL | Model confidence (0–1) |
| `latency_ms` | REAL | Inference time in milliseconds |
| `score_productive` | REAL | Raw NLI score for productive label |
| `score_distractive` | REAL | Raw NLI score for distractive label |
