# Dongjoo Task Board (Kanban)

Interactive Korean Kanban board for Dongjoo, deployed on GitHub Pages.

Live: https://dongjoo-cloud.github.io/task-board/

Columns: **할 일** / **진행 중** / **완료** / **내 업무 아님**. Drag cards between columns, or use right-click / 「상태 변경」. Max-width ~1540px. Card body/action text keep line breaks (`white-space: pre-wrap`).

## How sync works (no user-facing PAT)

| Piece | Role |
|-------|------|
| `data/tasks.json` | Source of truth for open items (agent writes on each digest). Default `status` per task: `todo` \| `in_progress` \| `done` \| `not_mine`. |
| `data/done.json` | **Status map** (user overrides from the board). See schema below. |
| Actions secret `BOARD_WRITE_TOKEN` | Limited write credential (stored as repo secret only — never committed as plaintext source on `main`). |
| `.github/workflows/deploy-pages.yml` | Builds Pages artifact and **injects** `js/config.js` from `BOARD_WRITE_TOKEN`. |
| `.github/workflows/board-status.yml` | On `repository_dispatch` type `board-status`, writes `data/done.json` using default `GITHUB_TOKEN`. |
| `index.html` + `styles.css` + `js/app.js` | Static Kanban UI (no Settings / PAT paste UI). |

Drag between columns:

1. Optimistic update to **localStorage** immediately
2. Browser `POST /repos/.../dispatches` with baked token from `js/config.js` (`event_type: board-status`, payload = full `ids` map or single `id`/`status`)
3. `board-status` workflow commits `data/done.json` on `main`
4. Parent agent reads `data/done.json` from GitHub before the next digest / screening

There is **no gear icon / PAT paste UI**. The write token is injected only into the Pages deploy artifact.

> Prefer a **fine-grained PAT** with Contents: write on `dongjoo-cloud/task-board` only as `BOARD_WRITE_TOKEN`. If that is hard to mint via CLI, a `gh auth token` may be stored as the secret for this personal board — rotate to fine-grained when convenient.

## Status storage (`data/done.json`) — for agents

```json
{
  "ids": {
    "<externalId>": {
      "status": "todo" | "in_progress" | "done" | "not_mine",
      "at": "2026-10-02T01:23:45.678Z"
    }
  }
}
```

- **Override wins**: if an id is present in `done.json`, use that `status` instead of `tasks.json`’s default `status`.
- **Missing id**: fall back to `tasks.json` → `task.status` (`todo` / `in_progress` / `done` / `not_mine`).
- **`not_mine`**: same screening treatment as `done` — do not re-nudge; keep the card out of active work.
- **Legacy**: old checkbox shape `{ "done": true, "at": "…" }` is still accepted and treated as `status: "done"`.
- Local cache key: `task-board:done` (status map).

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

## Agent workflow

```bash
# Read status map (before screening)
gh api repos/dongjoo-cloud/task-board/contents/data/done.json \
  --jq '.content' | base64 -d

# Refresh open items (edit data/tasks.json, commit, push)
# Keep task ids stable so done.json overrides still match.
```

## Secret / deploy ops

```bash
# Set or rotate the write token (do not commit plaintext)
gh secret set BOARD_WRITE_TOKEN -R dongjoo-cloud/task-board

# Pages deploys on push to main via Actions (injects js/config.js)
# Manual redeploy:
gh workflow run "Deploy Pages" -R dongjoo-cloud/task-board
```

`js/config.js` is gitignored. See `js/config.example.js` for the shape.

Fallback mode: set `BOARD_CONFIG.mode` to `"contents"` in the deploy injector to PUT via Contents API instead of `repository_dispatch` (same secret).

## License

Private-use personal board for Dongjoo.
