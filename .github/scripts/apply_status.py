"""Apply a board-status repository_dispatch payload to data/done.json.

Payload: {"ids": {id: {status, at}}}  (full map, replaces done.json)
     or  {"id": "...", "status": "...", "at"?: "..."}  (single update)

Ids already archived (pruned after 24h in done/not_mine) are dropped unless the
card is back in tasks.json, so stale browser localStorage can't resurrect them.
Prints BOARD_CHANGED=0/1 to $GITHUB_ENV.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import board_lib as B  # noqa: E402

payload = json.loads(os.environ.get("CLIENT_PAYLOAD") or "{}") or {}
now = B.iso(B.now_utc())

ids = {}
for k, v in B.load_done_ids().items():
    n = B.normalize_entry(v, now)
    if n:
        ids[str(k)] = n

if isinstance(payload.get("ids"), dict):
    new_ids = {}
    for k, v in payload["ids"].items():
        n = B.normalize_entry(v, now)
        if n:
            new_ids[str(k)] = n
    ids = new_ids
elif payload.get("id") and payload.get("status") in B.STATUSES:
    ids[str(payload["id"])] = {"status": payload["status"], "at": payload.get("at") or now}
else:
    raise SystemExit("client_payload must include ids{} or id+status")

archived = B.load_archive_ids()
tasks_doc = B.read_json(B.TASKS, {"tasks": []})
live_ids = {str(t.get("id")) for t in tasks_doc.get("tasks", []) if isinstance(t, dict)}
dropped = [k for k in ids if k in archived and k not in live_ids]
for k in dropped:
    ids.pop(k, None)
if dropped:
    print("Dropped %d archived ids: %s" % (len(dropped), ", ".join(sorted(dropped))))

changed = B.write_if_changed(B.DONE, {"ids": dict(sorted(ids.items()))})
print(("Updated" if changed else "No change to") + " data/done.json (%d ids)" % len(ids))
env_file = os.environ.get("GITHUB_ENV")
if env_file:
    with open(env_file, "a", encoding="utf-8") as f:
        f.write("BOARD_CHANGED=%d\n" % (1 if changed else 0))
