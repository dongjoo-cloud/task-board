"""One-off: set tasks.json created_at from first git commit containing each card id."""
import json, subprocess, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
import board_lib as B
commits = subprocess.check_output(["git","log","--reverse","--format=%H %cI","--","data/tasks.json"], text=True).split("\n")
first = {}
for line in filter(None, commits):
    h, t = line.split(" ", 1)
    try:
        doc = json.loads(subprocess.check_output(["git","show",f"{h}:data/tasks.json"], text=True))
    except Exception:
        continue
    for x in (doc.get("tasks", []) if isinstance(doc, dict) else doc):
        if isinstance(x, dict) and x.get("id") is not None:
            first.setdefault(str(x["id"]), B.iso(B.parse_iso(t)))
doc = B.read_json(B.TASKS, {"tasks": []})
for x in doc["tasks"]:
    if not x.get("created_at"):
        x["created_at"] = first.get(str(x.get("id"))) or x.get("status_at") or B.iso(B.now_utc())
    if x.get("priority") == "still":
        x.pop("priority")
    print(x["id"], x["created_at"], x.get("status"))
B.write_if_changed(B.TASKS, doc)
