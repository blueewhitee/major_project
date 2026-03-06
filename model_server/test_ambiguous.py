# -*- coding: utf-8 -*-
import requests, sys, time, statistics

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8000/classify"

CASES = [
    ("10 Things Successful People Do Before 8AM",        "https://youtube.com/watch?v=1"),
    ("How I Made $1 Million By Age 25 (The Truth)",      "https://youtube.com/watch?v=2"),
    ("I Studied 12 Hours a Day For 30 Days - Results",   "https://youtube.com/watch?v=3"),
    ("My Entire Daily Routine As A Self-Taught Dev",     "https://youtube.com/watch?v=4"),
    ("The Algorithm That Controls Your Life",            "https://youtube.com/watch?v=5"),
    ("The Dark Side Of Being Famous Nobody Talks About", "https://youtube.com/watch?v=6"),
    ("Why Smart People Are Always Alone",                "https://youtube.com/watch?v=7"),
    ("I Ate Like The Rock For 7 Days",                   "https://youtube.com/watch?v=8"),
    ("How NASA Almost Lost Everything In 30 Seconds",    "https://youtube.com/watch?v=9"),
    ("The Untold Story Of Zuckerbergs Biggest Mistake",  "https://youtube.com/watch?v=10"),
]

wall_times  = []
model_times = []
confidences = []
results     = []

print(f"  {'RESULT':<12} {'P':>5} {'D':>5} {'model_ms':>9} {'wall_ms':>8}   TITLE")
print("-" * 92)

for title, url in CASES:
    t0      = time.perf_counter()
    r       = requests.post(BASE, json={"url": url, "title": title}, timeout=60).json()
    wall_ms = (time.perf_counter() - t0) * 1000

    cls      = r["classification"]
    p        = r["raw_scores"]["PRODUCTIVE"]
    d        = r["raw_scores"]["DISTRACTIVE"]
    model_ms = r["latency_ms"]
    conf     = r["confidence"]
    tag      = "[D]" if cls == "DISTRACTIVE" else ("[?]" if cls == "UNCERTAIN" else "[P]")

    wall_times.append(wall_ms)
    model_times.append(model_ms)
    confidences.append(conf)
    results.append(cls)

    print(f"  {tag} {cls:<10} {p:>5.2f} {d:>5.2f} {model_ms:>9.1f} {wall_ms:>8.1f}   {title[:55]}")

# -- Summary --
n_total       = len(results)
n_distractive = results.count("DISTRACTIVE")
n_productive  = results.count("PRODUCTIVE")
n_uncertain   = results.count("UNCERTAIN")
pct_caught    = n_distractive / n_total * 100

real_model_times = [t for t in model_times if t > 0]

print("-" * 92)
print(f"\n  Classification :  {n_distractive} DISTRACTIVE   {n_productive} PRODUCTIVE   {n_uncertain} UNCERTAIN   ({pct_caught:.0f}% caught as distracting)")
print(f"\n  Wall time      (HTTP roundtrip):")
print(f"    avg {statistics.mean(wall_times):>7.1f} ms  |  min {min(wall_times):>7.1f} ms  |  max {max(wall_times):>7.1f} ms  |  total {sum(wall_times)/1000:.2f}s")
if real_model_times:
    print(f"\n  Model time     (NLI inference only, fast-path excluded):")
    print(f"    avg {statistics.mean(real_model_times):>7.1f} ms  |  min {min(real_model_times):>7.1f} ms  |  max {max(real_model_times):>7.1f} ms")
print(f"\n  Confidence     :")
print(f"    avg {statistics.mean(confidences):>5.1%}  |  min {min(confidences):>5.1%}  |  max {max(confidences):>5.1%}  |  stdev {statistics.stdev(confidences):.3f}")
