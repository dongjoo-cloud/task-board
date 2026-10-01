# Dongjoo Task Board

Narrow (~680px) interactive task board for Dongjoo, deployed on GitHub Pages.

Live: https://dongjoo-cloud.github.io/task-board/

Similar aesthetic to [bugsnag-sentry-status](https://dongjoo-cloud.github.io/bugsnag-sentry-status/), but interactive.

## How it works

| File | Role |
|------|------|
| `data/tasks.json` | Source of truth for open items (agent writes on each digest) |
| `data/done.json` | Completion map `{ "ids": { "<externalId>": { "done": true, "at": "ISO" } } }` |
| `index.html` + `styles.css` + `js/app.js` | Static UI |

Checkboxes:

1. Optimistic update to **localStorage** immediately
2. If a fine-grained PAT is saved in Settings (gear icon), also **PUT** `data/done.json` via the GitHub Contents API
3. Parent agent reads `data/done.json` from GitHub before the next digest

Token stays in the browser (`localStorage` key `task-board:pat`). It is never committed.

## One-time PAT setup

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: `task-board-done` (or similar)
3. Resource owner: **dongjoo-cloud**
4. Repository access: **Only select repositories** → `task-board`
5. Permissions → Repository permissions:
   - **Contents**: Read and write
   - **Metadata**: Read-only (default)
6. Generate, copy token
7. Open the board → gear icon → paste token → Save

After that, checking/unchecking a box commits an update to `data/done.json` on `main` (Pages rebuilds shortly after).

## Agent workflow

```bash
# Read completions
gh api repos/dongjoo-cloud/task-board/contents/data/done.json \
  --jq '.content' | base64 -d

# Refresh open items (edit data/tasks.json, commit, push)
```

Stable external IDs (examples):

- `slack:<ts>` e.g. `slack:1790877441.863009`
- `gmail:<slug>` e.g. `gmail:ramp-weekly-2026-10-01`

## Deploy

GitHub Pages from `main` / (root), same pattern as `bugsnag-sentry-status`.

```bash
# after push
gh api -X POST repos/dongjoo-cloud/task-board/pages \
  -f build_type=legacy \
  -f source='{"branch":"main","path":"/"}'   # first time only
```

## Note on Notion

An earlier Notion DB approach was rejected — prefer this repo as the board. Parent agent can trash any leftover Notion task DB.

## License

Private-use personal board for Dongjoo.
