import requests, json

# Today in IST: midnight IST = 18:30:00 UTC on the previous calendar day
# Current time is 2026-03-05T02:04 IST = 2026-03-04T20:34Z UTC
timeperiod = "2026-03-04T18:30:00Z/2026-03-04T20:34:00Z"

query = (
    "events = query_bucket('aw-watcher-window_ASHU');"
    "overleaf = filter_keyvals(events, 'title', ["
    "'IEEE Conference Template - Online LaTeX Editor Overleaf - Google Chrome',"
    "'Overleaf, Online LaTeX Editor - Google Chrome'"
    "]);"
    "duration = sum_durations(overleaf);"
    "RETURN = {'total_duration': duration};"
)

resp = requests.post(
    "http://localhost:5600/api/0/query/",
    json={"timeperiods": [timeperiod], "query": [query]},
    timeout=10,
)
data = resp.json()
total_sec = data[0]["total_duration"]
minutes = total_sec / 60
print(f"Total Overleaf duration today (IST): {total_sec:.1f} seconds = {minutes:.2f} minutes")
print(f"Raw response: {json.dumps(data, indent=2)}")
