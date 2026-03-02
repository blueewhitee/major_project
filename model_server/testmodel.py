from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import pipeline, AutoTokenizer
import re
import sys
import time


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
    interactive_mode()