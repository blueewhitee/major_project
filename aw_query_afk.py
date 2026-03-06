import requests, json

# Query AFK status during Overleaf window: 19:03Z - 19:12Z (UTC)
# That's 00:33 - 00:42 IST March 5
timeperiod = "2026-03-04T19:03:00Z/2026-03-04T19:12:00Z"

query = (
    "afk = query_bucket('aw-watcher-afk_ASHU');"
    "not_afk = filter_keyvals(afk, 'status', ['not-afk']);"
    "afk_only = filter_keyvals(afk, 'status', ['afk']);"
    "RETURN = {"
    "  'not_afk_duration': sum_durations(not_afk),"
    "  'afk_duration': sum_durations(afk_only),"
    "  'not_afk_events': not_afk,"
    "  'afk_events': afk_only"
    "};"
)

resp = requests.post(
    "http://localhost:5600/api/0/query/",
    json={"timeperiods": [timeperiod], "query": [query]},
    timeout=10,
)
data = resp.json()[0]

not_afk_sec = data["not_afk_duration"]
afk_sec = data["afk_duration"]
total = not_afk_sec + afk_sec

print(f"Window: 19:03Z - 19:12Z UTC (9 min window, Overleaf was open)")
print(f"  NOT-AFK (active): {not_afk_sec:.1f}s = {not_afk_sec/60:.1f} min")
print(f"  AFK    (idle):    {afk_sec:.1f}s = {afk_sec/60:.1f} min")
print(f"  Total accounted:  {total:.1f}s")
print()
print("AFK event breakdown:")
for e in data["afk_events"]:
    print(f"  AFK   from {e['timestamp'][:19]} for {e['duration']:.1f}s")
print("NOT-AFK event breakdown:")
for e in data["not_afk_events"]:
    print(f"  ACTIVE from {e['timestamp'][:19]} for {e['duration']:.1f}s")
