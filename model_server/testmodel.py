from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import pipeline, AutoTokenizer
import re
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


# ═══════════════════════════════════════════════════════════════════
#  CONFIG
# ═══════════════════════════════════════════════════════════════════
MODEL_DIR  = "C:/focus_tracker"
ONNX_FILE  = "model_quint8_avx2.onnx"
THRESHOLD  = 0.60

CANDIDATE_LABELS = [
    "work, study, research, coding, or professional development",
    "entertainment, humor, celebrity gossip, memes, or casual browsing",
]
LABEL_MAP = {
    "work, study, research, coding, or professional development": "PRODUCTIVE",
    "entertainment, humor, celebrity gossip, memes, or casual browsing": "DISTRACTIVE",
}
HYPOTHESIS_TEMPLATE = "This is {}."

# ── Thematic category labels (zero-shot, 10 clusters) ────────────
CATEGORY_LABELS = [
    "education",
    "entertainment",
    "news",
    "music",
    "gaming",
    "shopping",
    "productivity",
    "health",
    "social",
    "finance",
]
CATEGORY_THRESHOLD = 0.45

# ── Entertainment trigger labels (third-pass, gated by entertainment category) ──
ENTERTAINMENT_TRIGGER_LABELS = [
    "short-form video clips or reels",
    "doom-scrolling social media feeds",
    "binge-watching episodes or movies",
    "falling into a recommendation rabbit hole",
    "watching live-stream content",
    "compulsively checking news updates",
    "watching sports streams, highlights, or live scores",
    "watching gaming content, gameplay, or speedruns",
    "browsing memes and humor content",
    "listening to podcast or audio-first content",
]
TRIGGER_LABEL_MAP = {
    "short-form video clips or reels": "short-form",
    "doom-scrolling social media feeds": "doom-scroll",
    "binge-watching episodes or movies": "binge-watch",
    "falling into a recommendation rabbit hole": "rabbit-hole",
    "watching live-stream content": "live-stream",
    "compulsively checking news updates": "news-loop",
    "watching sports streams, highlights, or live scores": "sports-stream",
    "watching gaming content, gameplay, or speedruns": "gaming-content",
    "browsing memes and humor content": "meme-browse",
    "listening to podcast or audio-first content": "podcast-audio",
}
TRIGGER_THRESHOLD = 0.50
TRIGGER_HYPOTHESIS_TEMPLATE = "This browsing activity is mainly {}."

# Query params that add noise and should not influence trigger intent.
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src", "igshid",
    "si", "feature",
}

# High-confidence fast-path trigger exemptions. Specific patterns must appear before broad ones.
_FAST_TRIGGER_RULES = [
    # short-form
    {"host_contains": "youtube.com", "path_contains": "/shorts/", "trigger": "short-form", "label": "YouTube Shorts"},
    {"host_contains": "instagram.com", "path_contains": "/reel", "trigger": "short-form", "label": "Instagram Reels"},
    {"host_contains": "facebook.com", "path_contains": "/reels", "trigger": "short-form", "label": "Facebook Reels"},
    {"host_contains": "tiktok.com", "trigger": "short-form", "label": "TikTok"},
    {"host_contains": "snapchat.com", "path_contains": "/spotlight", "trigger": "short-form", "label": "Snapchat Spotlight"},
    # binge-watch
    {"host_contains": "netflix.com", "trigger": "binge-watch", "label": "Netflix"},
    {"host_contains": "primevideo.com", "trigger": "binge-watch", "label": "Prime Video"},
    {"host_contains": "disneyplus.com", "trigger": "binge-watch", "label": "Disney+"},
    # live-stream
    {"host_contains": "twitch.tv", "trigger": "live-stream", "label": "Twitch"},
    {"host_contains": "youtube.com", "path_contains": "/live", "trigger": "live-stream", "label": "YouTube Live"},
    # doom-scroll broad social
    {"host_contains": "instagram.com", "trigger": "doom-scroll", "label": "Instagram Feed"},
]

# ── Pre-compiled patterns ─────────────────────────────────────────
_RE_DOMAIN = re.compile(r"https?://(?:www\.)?([^/:]+)")
_RE_TLDS = re.compile(
    r"\.(com|io|org|net|edu|gov|co|in|uk|me|tv|app|dev|ai|xyz|info|biz).*$",
    re.IGNORECASE,
)
_RE_SITE_SUFFIX = re.compile(
    r"[\|\-\u2013\u2014]\s*("
    r"YouTube|Google|Reddit|Twitter|LinkedIn|Facebook|Instagram|"
    r"TikTok|Netflix|Wikipedia|Medium|GitHub|Gmail|Stack Overflow|"
    r"Hacker News|Amazon|Pinterest"
    r").*$",
    re.IGNORECASE,
)


# ═══════════════════════════════════════════════════════════════════
#  MODEL LOADING
# ═══════════════════════════════════════════════════════════════════
def _load_classifier():
    print("Loading model...")
    t0 = time.perf_counter()
    try:
        tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
        model = ORTModelForSequenceClassification.from_pretrained(
            MODEL_DIR, file_name=ONNX_FILE, subfolder="onnx",
        )
        clf = pipeline(
            task="zero-shot-classification",
            model=model, tokenizer=tokenizer, device=-1,
        )
        print(f"Model loaded in {time.perf_counter() - t0:.1f}s")

        # Warm-up: first ONNX call carries session-init overhead
        clf("warmup", candidate_labels=["test"], hypothesis_template="{}.")
        print("Ready!\n")
        return clf
    except Exception as exc:
        print(f"FATAL -- could not load model: {exc}")
        sys.exit(1)


classifier = _load_classifier()


# ═══════════════════════════════════════════════════════════════════
#  PREMISE BUILDER  (title-dominant — no domain-type hints)
# ═══════════════════════════════════════════════════════════════════
def _extract_domain_name(url: str) -> str:
    m = _RE_DOMAIN.search(url)
    if not m:
        return "a website"
    raw   = m.group(1)
    clean = _RE_TLDS.sub("", raw)
    name  = clean.replace("-", " ").replace(".", " ").strip()
    return name or "a website"


def _clean_title(title: str) -> str:
    return _RE_SITE_SUFFIX.sub("", title).strip() or title


def _clean_title_for_trigger(title: str) -> str:
    title = _clean_title(title)
    # Collapse separators and duplicated whitespace that are often appended by sites.
    title = re.sub(r"\s*[\|\u2013\u2014]+\s*", " - ", title).strip()
    title = re.sub(r"\s+", " ", title).strip()
    return title[:220]


def _normalize_url_for_trigger(url: str) -> dict:
    try:
        p = urlparse(url)
    except Exception:
        return {"url": url, "host": "", "path": "", "query": ""}

    host = (p.hostname or "").lower()
    path = (p.path or "").lower()
    query_pairs = [
        (k.lower(), v)
        for k, v in parse_qsl(p.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    query_pairs.sort(key=lambda kv: kv[0])
    clean_query = urlencode(query_pairs, doseq=True)
    normalized = urlunparse((p.scheme or "https", host, p.path or "", "", clean_query, ""))
    return {
        "url": normalized,
        "host": host,
        "path": path,
        "query": clean_query.lower(),
    }


def _extract_trigger_signals(host: str, path: str, query: str, title: str) -> str:
    signals: list[str] = []
    if "/shorts/" in path or "/reel" in path:
        signals.append("short-clip navigation pattern")
    if "watch" in path and "youtube.com" in host:
        signals.append("single-video watch page")
    if any(k in title.lower() for k in ("season", "episode", "s01", "e01")):
        signals.append("episode-like title structure")
    if any(k in title.lower() for k in ("live", "stream", "highlights")):
        signals.append("live or stream language in title")
    if any(k in host for k in ("bbc.", "cnn.", "reuters.", "ndtv.", "nytimes.", "thehindu.")):
        signals.append("news-domain context")
    if any(k in host for k in ("cricbuzz", "espn", "livescore")):
        signals.append("sports-domain context")
    if "reddit.com/r/" in (host + path):
        signals.append("community-thread browsing context")
    if "open.spotify.com/episode" in (host + path):
        signals.append("podcast episode page")
    if "v=" in query and "youtube.com" in host:
        signals.append("direct video id query param")
    return ", ".join(signals[:5]) or "no strong structural signal"


def build_premise(url: str, title: str, description: str = "") -> str:
    domain_name = _extract_domain_name(url)
    title_clean = _clean_title(title)

    parts = [
        f"The user is on a website called {domain_name}.",
        f"The page is titled '{title_clean}'.",
    ]
    if description:
        parts.append(f"The content is described as: {description[:150].strip()}.")
    return " ".join(parts)


def build_entertainment_premise(url: str, title: str, description: str = "") -> str:
    norm = _normalize_url_for_trigger(url)
    title_clean = _clean_title_for_trigger(title)
    domain_name = _extract_domain_name(norm["url"])
    signals = _extract_trigger_signals(norm["host"], norm["path"], norm["query"], title_clean)

    parts = [
        f"The user is consuming entertainment content on {domain_name}.",
        f"Normalized URL context: host='{norm['host']}', path='{norm['path'][:90]}'.",
        f"Page title: '{title_clean}'.",
        f"Behavioral signals: {signals}.",
    ]
    if description:
        parts.append(f"Observed description: {description[:150].strip()}.")
    return " ".join(parts)


def _match_fast_trigger(url: str, title: str):
    norm = _normalize_url_for_trigger(url)
    host = norm["host"]
    path = norm["path"]
    lower_title = (title or "").lower()

    for rule in _FAST_TRIGGER_RULES:
        if "host_contains" in rule and rule["host_contains"] not in host:
            continue
        if "path_contains" in rule and rule["path_contains"] not in path:
            continue
        if "title_contains" in rule and rule["title_contains"] not in lower_title:
            continue
        return rule
    return None


# ═══════════════════════════════════════════════════════════════════
#  CLASSIFY
# ═══════════════════════════════════════════════════════════════════
def classify(url: str, title: str, description: str = "") -> dict:
    premise = build_premise(url, title, description)

    t0 = time.perf_counter()
    result = classifier(
        sequences=premise,
        candidate_labels=CANDIDATE_LABELS,
        hypothesis_template=HYPOTHESIS_TEMPLATE,
        multi_label=False,
    )
    latency_ms = (time.perf_counter() - t0) * 1000

    top_label = result["labels"][0]
    top_score = result["scores"][0]
    mapped    = LABEL_MAP[top_label]

    return {
        "premise":        premise,
        "classification": mapped if top_score >= THRESHOLD else "UNCERTAIN",
        "confidence":     round(top_score, 3),
        "latency_ms":     round(latency_ms, 1),
        "raw_scores": {
            LABEL_MAP[lab]: round(scr, 3)
            for lab, scr in zip(result["labels"], result["scores"])
        },
    }


# ═══════════════════════════════════════════════════════════════════
#  CLASSIFY CATEGORY
# ═══════════════════════════════════════════════════════════════════
def classify_category(url: str, title: str, description: str = "") -> dict:
    """Run a second zero-shot pass to assign one of 10 thematic categories."""
    premise = build_premise(url, title, description)

    t0 = time.perf_counter()
    result = classifier(
        sequences=premise,
        candidate_labels=CATEGORY_LABELS,
        hypothesis_template=HYPOTHESIS_TEMPLATE,
        multi_label=False,
    )
    latency_ms = (time.perf_counter() - t0) * 1000

    top_label = result["labels"][0]
    top_score = result["scores"][0]

    return {
        "category":    top_label if top_score >= CATEGORY_THRESHOLD else "uncategorized",
        "confidence":  round(top_score, 3),
        "latency_ms":  round(latency_ms, 1),
    }


def classify_entertainment_trigger(url: str, title: str, description: str = "") -> dict:
    """Third-pass trigger classifier; use only when category == entertainment."""
    fast = _match_fast_trigger(url, title)
    premise = build_entertainment_premise(url, title, description)
    if fast:
        trigger = fast["trigger"]
        return {
            "trigger": trigger,
            "label": fast.get("label", trigger),
            "confidence": 1.0,
            "latency_ms": 0.0,
            "source": "fast-path",
            "premise": premise,
            "raw_scores": {trigger: 1.0},
        }

    t0 = time.perf_counter()
    result = classifier(
        sequences=premise,
        candidate_labels=ENTERTAINMENT_TRIGGER_LABELS,
        hypothesis_template=TRIGGER_HYPOTHESIS_TEMPLATE,
        multi_label=False,
    )
    latency_ms = (time.perf_counter() - t0) * 1000

    top_label = result["labels"][0]
    top_score = result["scores"][0]
    mapped = TRIGGER_LABEL_MAP[top_label]
    trigger = mapped if top_score >= TRIGGER_THRESHOLD else "uncertain"

    return {
        "trigger": trigger,
        "label": top_label,
        "confidence": round(top_score, 3),
        "latency_ms": round(latency_ms, 1),
        "source": "model",
        "premise": premise,
        "raw_scores": {TRIGGER_LABEL_MAP.get(l, l): round(s, 3) for l, s in zip(result["labels"], result["scores"])},
    }


# ═══════════════════════════════════════════════════════════════════
#  TEST SUITE
# ═══════════════════════════════════════════════════════════════════
TEST_CASES = [
    # -- Productive --
    {"url": "https://docs.python.org/3/library/asyncio.html",
     "title": "asyncio Asynchronous I/O Python 3.12 documentation"},
    {"url": "https://stackoverflow.com/questions/51234/fix-memory-leak",
     "title": "How to fix memory leak in Python multiprocessing"},
    {"url": "https://github.com/huggingface/transformers",
     "title": "huggingface transformers State of the art ML for PyTorch"},
    {"url": "https://www.geeksforgeeks.org/dynamic-programming/",
     "title": "Dynamic Programming Top Interview Questions Explained"},
    # -- Distractive --
    {"url": "https://www.buzzfeed.com/quiz/which-pizza-are-you",
     "title": "Which Pizza Are You Based On Your Personality?"},
    {"url": "https://youtube.com/shorts/xYz123",
     "title": "I Ate Only Oreos For 7 Days shocking results"},
    {"url": "https://9gag.com/gag/meme-compilation-2024",
     "title": "Best Memes of 2024 Laugh Till You Cry"},
    {"url": "https://www.dailymail.co.uk/celebrity/",
     "title": "Kim Kardashian stuns fans with new look at Met Gala"},
    # -- Edge / Tricky --
    {"url": "https://youtube.com/watch?v=abc",
     "title": "I Built a Full Stack App in 24 Hours"},
    {"url": "https://reddit.com/r/programming/comments/xyz",
     "title": "Why async await is fundamentally broken in JavaScript"},
    {"url": "https://reddit.com/r/memes/",
     "title": "Me explaining to my mom why I need another monitor"},
    {"url": "https://medium.com/@user/my-morning-routine",
     "title": "I Woke Up at 4AM for 30 Days Here s What Happened"},
    # -- With description --
    {"url": "https://youtube.com/watch?v=xyz",
     "title": "Python Tutorial for Beginners",
     "description": "Learn Python from scratch. Covers variables, loops, functions, OOP and projects."},
    {"url": "https://youtube.com/watch?v=lmn",
     "title": "Try Not To Laugh Challenge",
     "description": "Funny fail compilation videos. Watch and comment your reactions below!"},
]

TRIGGER_TEST_CASES = [
    # Fast-path expected
    {"url": "https://www.youtube.com/shorts/abcd123", "title": "Crazy edit", "expect": "short-form"},
    {"url": "https://www.instagram.com/reel/xyz", "title": "funny reel", "expect": "short-form"},
    {"url": "https://www.netflix.com/watch/80192098", "title": "Episode 1 - Netflix", "expect": "binge-watch"},
    {"url": "https://www.twitch.tv/somechannel", "title": "LIVE: Just chatting", "expect": "live-stream"},
    {"url": "https://www.instagram.com/", "title": "Instagram", "expect": "doom-scroll"},
    # Ambiguous/model expected
    {"url": "https://www.youtube.com/watch?v=abc123", "title": "Top 10 hidden game mechanics", "expect_one_of": {"rabbit-hole", "gaming-content"}},
    {"url": "https://www.youtube.com/watch?v=def456", "title": "Season 1 Episode 3 recap", "expect_one_of": {"binge-watch", "rabbit-hole"}},
    {"url": "https://reddit.com/r/worldnews/comments/xyz", "title": "Breaking news live updates", "expect": "news-loop"},
    {"url": "https://open.spotify.com/episode/7abc", "title": "Podcast Episode 42", "expect": "podcast-audio"},
]


def run_tests():
    ICON = {"PRODUCTIVE": "[P]", "DISTRACTIVE": "[D]", "UNCERTAIN": "[?]"}
    W = 82

    print("=" * W)
    print(f"  {'TITLE':<42} {'RESULT':<12} {'CONF':>6} {'ms':>5}  SCORES")
    print("=" * W)

    total_ms = 0.0
    for case in TEST_CASES:
        out       = classify(**case)
        total_ms += out["latency_ms"]

        icon  = ICON.get(out["classification"], "[?]")
        t     = case["title"]
        short = (t[:39] + "..") if len(t) > 41 else t
        p     = out["raw_scores"]["PRODUCTIVE"]
        d     = out["raw_scores"]["DISTRACTIVE"]

        print(
            f"  {icon} {short:<42}"
            f" {out['classification']:<12}"
            f" {out['confidence']:>5.1%}"
            f" {out['latency_ms']:>5.0f}"
            f"  P:{p:.2f} D:{d:.2f}"
        )

    print("=" * W)
    n = len(TEST_CASES)
    print(f"  {n} cases | avg {total_ms / n:.0f} ms/call | total {total_ms:.0f} ms\n")


def run_trigger_tests():
    W = 94
    print("=" * W)
    print(f"  {'TRIGGER TEST TITLE':<46} {'PRED':<18} {'CONF':>6} {'SRC':<10} {'OK':<4}")
    print("=" * W)

    ok = 0
    total = 0
    total_ms = 0.0
    for case in TRIGGER_TEST_CASES:
        out = classify_entertainment_trigger(case["url"], case["title"], case.get("description", ""))
        total += 1
        total_ms += out["latency_ms"]
        pred = out["trigger"]
        conf = out["confidence"]
        source = out["source"]

        expected = case.get("expect")
        expected_set = case.get("expect_one_of")
        passed = False
        if expected is not None:
            passed = pred == expected
        elif expected_set is not None:
            passed = pred in expected_set

        if passed:
            ok += 1
        title = case["title"]
        short = (title[:43] + "..") if len(title) > 45 else title
        print(f"  {short:<46} {pred:<18} {conf:>5.1%}  {source:<10} {'yes' if passed else 'no'}")

    print("=" * W)
    avg = (total_ms / total) if total else 0.0
    print(f"  trigger tests: {ok}/{total} passing | avg {avg:.0f} ms/call | total {total_ms:.0f} ms\n")


# ═══════════════════════════════════════════════════════════════════
#  INTERACTIVE MODE
# ═══════════════════════════════════════════════════════════════════
def interactive_mode():
    print("INTERACTIVE MODE -- type 'quit' to exit\n")
    while True:
        try:
            url = input("URL   : ").strip()
            if not url or url.lower() == "quit":
                break
            title = input("Title : ").strip()
            if not title:
                print("  (title cannot be empty)\n")
                continue
            desc = input("Desc  : (Enter to skip) ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        out = classify(url, title, desc)
        print(
            f"\n  Premise    : {out['premise']}\n"
            f"  Result     : {out['classification']}\n"
            f"  Confidence : {out['confidence']:.1%}\n"
            f"  Latency    : {out['latency_ms']:.0f} ms\n"
            f"  Scores     : P={out['raw_scores']['PRODUCTIVE']:.3f}"
            f"  D={out['raw_scores']['DISTRACTIVE']:.3f}\n"
        )

    print("\nGoodbye!")


# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    run_tests()
    run_trigger_tests()
    interactive_mode()