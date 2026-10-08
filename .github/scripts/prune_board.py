"""Prune done / not_mine cards older than 24h into data/archive.json.

- Stamps task.status_at = now for tasks.json cards whose default status is
  done/not_mine but which have no timestamp (no done.json override and no
  status_at), so they expire 24h after first being seen.
- Moves expired cards (effective status done/not_mine, status time > 24h ago)
  out of tasks.json and done.json into archive.json (id -> metadata). The
  screening routine must skip ids present in archive.json.
- Drops stale done.json ids that are archived and no longer in tasks.json.
Idempotent; writes files only when something changes. Prints a summary and
sets BOARD_CHANGED=0/1 in $GITHUB_ENV when available.
Env: PRUNE_TTL_HOURS (default 24), PRUNE_NOW (ISO, for testing).
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import board_lib as B  # noqa: E402

now = B.parse_iso(os.environ.get("PRUNE_NOW")) or B.now_utc()
ttl = datetime.timedelta(hours=float(os.environ.get("PRUNE_TTL_HOURS") or B.TTL_HOURS))
now_s = B.iso(now)

tasks_doc = B.read_json(B.TASKS, {"tasks": []})
tasks = [t for t in tasks_doc.get("tasks", []) if isinstance(t, dict)]
done_ids = B.load_done_ids()
archive = B.load_archive_ids()

stamped, archived_now, kept = [], [], []
for t in tasks:
    tid = str(t.get("id"))
    override = B.normalize_entry(done_ids.get(tid), None) if tid in done_ids else None
    if override:
        status, at = override["status"], B.parse_iso(override["at"])
    else:
        status = t.get("status") if t.get("status") in B.STATUSES else "todo"
        at = B.parse_iso(t.get("status_at"))
        if status in B.CLOSED and at is None:
            t["status_at"] = now_s
            at = now
            stamped.append(tid)
    if status in B.CLOSED and at is not None and now - at > ttl:
        archive[tid] = {
            "status": status,
            "at": B.iso(at),
            "archived_at": now_s,
            "title": t.get("title") or "",
            "source": t.get("source") or "",
        }
        done_ids.pop(tid, None)
        archived_now.append(tid)
    else:
        kept.append(t)

live = {str(t.get("id")) for t in kept}
orphans = []
for tid in list(done_ids):
    if tid in live:
        continue
    entry = B.normalize_entry(done_ids[tid], None)
    at = B.parse_iso(entry["at"]) if entry else None
    if tid in archive:
        done_ids.pop(tid)
        orphans.append(tid)
    elif entry and entry["status"] in B.CLOSED and at is not None and now - at > ttl:
        archive[tid] = {"status": entry["status"], "at": B.iso(at), "archived_at": now_s, "title": "", "source": tid.split(":", 1)[0]}
        done_ids.pop(tid)
        orphans.append(tid)

tasks_doc["tasks"] = kept
changed = False
changed |= B.write_if_changed(B.TASKS, tasks_doc)
changed |= B.write_if_changed(B.DONE, {"ids": dict(sorted(done_ids.items()))})
if archive or B.ARCHIVE.exists():
    changed |= B.write_if_changed(B.ARCHIVE, {"ids": dict(sorted(archive.items()))})

print("now=%s ttl=%s" % (now_s, ttl))
print("stamped status_at: %s" % (", ".join(stamped) or "-"))
print("archived: %s" % (", ".join(archived_now) or "-"))
print("removed stale done.json ids: %s" % (", ".join(orphans) or "-"))
print("tasks remaining: %d, archive size: %d" % (len(kept), len(archive)))
summary = "prune: archived %d, stamped %d, cleaned %d" % (len(archived_now), len(stamped), len(orphans))
env_file = os.environ.get("GITHUB_ENV")
if env_file:
    with open(env_file, "a", encoding="utf-8") as f:
        f.write("BOARD_CHANGED=%d\nPRUNE_SUMMARY=%s\n" % (1 if changed else 0, summary))
