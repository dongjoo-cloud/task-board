# Dongjoo Task Board (Kanban)

Interactive Korean Kanban board for Dongjoo, deployed on GitHub Pages.

Live: https://dongjoo-cloud.github.io/task-board/

Columns: **할 일** / **진행 중** / **완료**. Drag cards between columns (no checkboxes). Max-width ~980px.

## How it works

| File | Role |
|------|------|
| `data/tasks.json` | Source of truth for open items (agent writes on each digest). Default `status` per task: `todo` \| `in_progress` \| `done`. |
| `data/done.json` | **Status map** (user overrides from the board). See schema below. |
| `index.html` + `styles.css` + `js/app.js` | Static Kanban UI |

Drag between columns:

1. Optimistic update to **localStorage** immediately
2. If a fine-grained PAT is saved in Settings (gear icon), also **PUT** `data/done.json` via the GitHub Contents API
3. Parent agent reads `data/done.json` from GitHub before the next digest / screening

Token stays in the browser (`localStorage` key `task-board:pat`). It is never committed.

## Status storage (`data/done.json`) — for agents

```json
{
  "ids": {
    "<externalId>": {
      "status": "todo" | "in_progress" | "done",
      "at": "2026-10-02T01:23:45.678Z"
    }
  }
}
```

- **Override wins**: if an id is present in `done.json`, use that `status` instead of `tasks.json`’s default `status`.
- **Missing id**: fall back to `tasks.json` → `task.status` (`todo` / `in_progress` / `done`).
- **Legacy**: old checkbox shape `{ "done": true, "at": "…" }` is still accepted and treated as `status: "done"`.
- Local cache key: `task-board:done` (same key; now stores status map).

When screening / writing the next digest:

```bash
# Read kanban overrides
gh api repos/dongjoo-cloud/task-board/contents/data/done.json \
  --jq '.content' | base64 -d

# Effective column for a task:
#   done.json.ids[id].status  ??  tasks.json.tasks[].status  ??  "todo"
```

Stable external IDs (examples):

- `slack:<ts>` e.g. `slack:1790877441.863009`
- `gmail:<slug>` e.g. `gmail:ramp-weekly-2026-10-01`

## One-time PAT setup

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: `task-board-status` (or similar)
3. Resource owner: **dongjoo-cloud**
4. Repository access: **Only select repositories** → `task-board`
5. Permissions → Repository permissions:
   - **Contents**: Read and write
   - **Metadata**: Read-only (default)
6. Generate, copy token
7. Open the board → gear icon → paste token → Save

After that, dragging a card between columns commits an update to `data/done.json` on `main` (Pages rebuilds shortly after).

## Agent workflow

```bash
# Read status map (before screening)
gh api repos/dongjoo-cloud/task-board/contents/data/done.json \
  --jq '.content' | base64 -d

# Refresh open items (edit data/tasks.json, commit, push)
# Keep task ids stable so done.json overrides still match.
```

## Deploy

GitHub Pages from `main` / (root), same pattern as `bugsnag-sentry-status`.

## License

Private-use personal board for Dongjoo.
