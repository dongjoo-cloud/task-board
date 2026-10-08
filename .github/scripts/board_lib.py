"""Shared helpers for task-board workflows (status sync + 24h prune).

Data files (repo root):
  data/tasks.json   {"tasks": [{id, status, status_at?, ...}], ...}
  data/done.json    {"ids": {id: {"status": ..., "at": ISO}}}   (board overrides)
  data/archive.json {"ids": {id: {"status", "at", "archived_at", "title", "source"}}}

Effective status of a task = done.json.ids[id].status ?? task.status ?? "todo".
Effective status time    = done.json.ids[id].at     ?? task.status_at.
Cards whose effective status is done / not_mine for longer than TTL are
"expired": hidden by the UI and physically moved to archive.json by prune.
"""
import datetime
import json
import pathlib

STATUSES = ("todo", "in_progress", "done", "not_mine")
CLOSED = ("done", "not_mine")
TTL_HOURS = 24

TASKS = pathlib.Path("data/tasks.json")
DONE = pathlib.Path("data/done.json")
ARCHIVE = pathlib.Path("data/archive.json")


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s):
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def read_json(path, default):
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return data if isinstance(data, type(default)) else default


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_if_changed(path, data):
    text = dump(data)
    prev = path.read_text(encoding="utf-8") if path.exists() else ""
    if prev == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def normalize_entry(entry, default_at):
    if not isinstance(entry, dict):
        return None
    status = entry.get("status")
    if status not in STATUSES:
        if entry.get("done") is True:
            status = "done"
        elif entry.get("done") is False:
            status = "todo"
        else:
            return None
    return {"status": status, "at": entry.get("at") or default_at}


def load_done_ids():
    state = read_json(DONE, {"ids": {}})
    ids = state.get("ids")
    return ids if isinstance(ids, dict) else {}


def load_archive_ids():
    state = read_json(ARCHIVE, {"ids": {}})
    ids = state.get("ids")
    return ids if isinstance(ids, dict) else {}
