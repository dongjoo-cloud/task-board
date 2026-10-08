const REPO = { owner: "dongjoo-cloud", name: "task-board", branch: "main" };
const DONE_PATH = "data/done.json";
const LS_DONE = "task-board:done";
/** done / not_mine cards disappear this long after entering that status. */
const CLOSED_TTL_MS = 24 * 60 * 60 * 1000;

/** Canonical column statuses persisted in done.json */
const STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  NOT_MINE: "not_mine",
};

const STATUS_ORDER = [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.DONE, STATUS.NOT_MINE];
const CLOSED_STATUSES = [STATUS.DONE, STATUS.NOT_MINE];

const STATUS_LABEL = {
  todo: "할 일",
  in_progress: "진행 중",
  done: "완료",
  not_mine: "내 업무 아님",
};

const el = {
  title: document.getElementById("board-title"),
  sub: document.getElementById("board-sub"),
  banner: document.getElementById("setup-banner"),
  kpiTodo: document.getElementById("kpi-todo"),
  kpiProgress: document.getElementById("kpi-progress"),
  kpiDone: document.getElementById("kpi-done"),
  kpiNotMine: document.getElementById("kpi-not-mine"),
  countTodo: document.getElementById("count-todo"),
  countProgress: document.getElementById("count-progress"),
  countDone: document.getElementById("count-done"),
  countNotMine: document.getElementById("count-not-mine"),
  listTodo: document.getElementById("list-todo"),
  listProgress: document.getElementById("list-progress"),
  listDone: document.getElementById("list-done"),
  listNotMine: document.getElementById("list-not-mine"),
  toast: document.getElementById("toast"),
};

/** @type {{ids: Record<string, {status:string, at:string, done?:boolean}>}} */
let doneState = { ids: {} };
/** @type {Array<any>} */
let tasks = [];
/** Ids pruned into data/archive.json (done/not_mine > 24h). */
let archivedIds = new Set();
let lastVisibleKey = "";
let toastTimer = null;
let syncLock = Promise.resolve();
let dragId = null;

function boardConfig() {
  return window.BOARD_CONFIG || {};
}

function getWriteToken() {
  return String(boardConfig().token || "").trim();
}

function writeMode() {
  const m = String(boardConfig().mode || "dispatch").toLowerCase();
  return m === "contents" ? "contents" : "dispatch";
}

function cacheBust(url) {
  const u = new URL(url, location.href);
  u.searchParams.set("t", String(Date.now()));
  return u.toString();
}

function loadLocalDone() {
  try {
    const raw = localStorage.getItem(LS_DONE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.ids) return normalizeState(parsed);
  } catch (_) {}
  return null;
}

function saveLocalDone(state) {
  localStorage.setItem(LS_DONE, JSON.stringify(state));
}

/** Normalize legacy {done:boolean} entries into {status}. */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  let status = entry.status;
  if (!STATUS_ORDER.includes(status)) {
    if (entry.done === true) status = STATUS.DONE;
    else if (entry.done === false) status = STATUS.TODO;
    else return null;
  }
  return { status, at: entry.at || new Date().toISOString() };
}

function normalizeState(state) {
  const out = { ids: {} };
  for (const [id, entry] of Object.entries(state?.ids || {})) {
    const n = normalizeEntry(entry);
    if (n) out.ids[id] = n;
  }
  return out;
}

function mergeDone(remote, local) {
  const out = { ids: { ...(normalizeState(remote).ids) } };
  const localIds = normalizeState(local).ids;
  for (const [id, entry] of Object.entries(localIds)) {
    const r = out.ids[id];
    if (!r) {
      out.ids[id] = entry;
      continue;
    }
    const lt = Date.parse(entry?.at || 0) || 0;
    const rt = Date.parse(r?.at || 0) || 0;
    if (lt >= rt) out.ids[id] = entry;
  }
  return out;
}

function getOverrideStatus(id) {
  const entry = doneState.ids?.[id];
  if (!entry) return null;
  return entry.status || null;
}

function formatStatusAt(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " KST";
  } catch (_) {
    return iso;
  }
}

function toast(msg, isErr = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle("err", Boolean(isErr));
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
}

function updateBanner() {
  const hasToken = Boolean(getWriteToken());
  if (hasToken) {
    el.banner.hidden = true;
    el.banner.textContent = "";
    return;
  }
  el.banner.hidden = false;
  el.banner.className = "banner warn";
  el.banner.innerHTML =
    "배포 설정(<code>js/config.js</code>)에 쓰기 토큰이 없어 열 이동은 <code>localStorage</code>에만 저장됩니다. " +
    "Pages 배포 워크플로가 Actions secret <code>BOARD_WRITE_TOKEN</code>으로 config를 주입하면 " +
    "<code>data/done.json</code>에 동기화됩니다.";
}

function renderEmpty(listEl, label) {
  listEl.innerHTML = `<div class="empty">${label} 항목이 없습니다</div>`;
}

function linkLabel(task) {
  const source = (task.source || "").toLowerCase();
  if (source === "slack") return "스레드";
  if (source === "gmail") return "메일";
  return "열기";
}

function cardHtml(task) {
  const col = bucketFor(task);
  const priority = task.priority || "";
  const source = task.source || "";
  const pills = [];
  if (priority === "new") pills.push('<span class="pill new">NEW</span>');
  if (priority === "still") pills.push('<span class="pill still">STILL</span>');
  if (source) pills.push(`<span class="pill ${source}">${source}</span>`);
  const statusAt = statusAtFor(task);
  if (statusAt) {
    pills.push(`<span class="pill status-at">${formatStatusAt(statusAt)}</span>`);
  }
  const body = task["내용"] || task.summary || "";
  const action = task["액션"] || task.action || "";
  const link = task.link
    ? `<a href="${escapeAttr(task.link)}" target="_blank" rel="noopener" draggable="false">${linkLabel(task)}</a>`
    : "";
  return `
    <article class="card ${col === STATUS.DONE ? "is-done" : ""}${col === STATUS.NOT_MINE ? " is-not-mine" : ""}" data-id="${escapeAttr(task.id)}" draggable="true">
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(task.title || task.id)}</span>
          ${pills.join("")}
        </div>
        ${body ? `<div class="summary">${escapeHtml(body)}</div>` : ""}
        ${action ? `<div class="action"><span class="action-label">액션</span><div class="action-text">${escapeHtml(action)}</div></div>` : ""}
        <div class="meta">
          <span class="id">${escapeHtml(task.id)}</span>
          ${link}
          <button type="button" class="card-menu-btn" data-menu-for="${escapeAttr(task.id)}" draggable="false" aria-label="상태 변경" title="상태 변경">상태 변경</button>
        </div>
      </div>
    </article>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function normalizeTaskStatus(raw) {
  if (raw === STATUS.IN_PROGRESS || raw === "progress") return STATUS.IN_PROGRESS;
  if (raw === STATUS.DONE) return STATUS.DONE;
  if (raw === STATUS.NOT_MINE) return STATUS.NOT_MINE;
  return STATUS.TODO;
}

function bucketFor(task) {
  const override = getOverrideStatus(task.id);
  if (override) return override;
  return normalizeTaskStatus(task.status);
}

/** When the card entered its current column: done.json override `at`, else tasks.json `status_at`. */
function statusAtFor(task) {
  const entry = doneState.ids?.[task.id];
  if (entry && entry.status) return entry.at || null;
  return task.status_at || null;
}

/** done / not_mine for longer than CLOSED_TTL_MS → hidden. No timestamp → stays visible. */
function isExpired(task, now = Date.now()) {
  if (!CLOSED_STATUSES.includes(bucketFor(task))) return false;
  const t = Date.parse(statusAtFor(task) || "");
  if (!Number.isFinite(t)) return false;
  return now - t > CLOSED_TTL_MS;
}

function visibleTasks(now = Date.now()) {
  return tasks.filter((t) => !isExpired(t, now));
}

function render() {
  const buckets = { todo: [], in_progress: [], done: [], not_mine: [] };
  const visible = visibleTasks();
  lastVisibleKey = visible.map((t) => `${t.id}:${bucketFor(t)}`).join("|");
  for (const t of visible) {
    const b = bucketFor(t);
    (buckets[b] || buckets.todo).push(t);
  }

  const fill = (listEl, items, label) => {
    if (!items.length) {
      renderEmpty(listEl, label);
      return;
    }
    listEl.innerHTML = items.map(cardHtml).join("");
  };

  fill(el.listTodo, buckets.todo, "할 일");
  fill(el.listProgress, buckets.in_progress, "진행 중");
  fill(el.listDone, buckets.done, "완료");
  fill(el.listNotMine, buckets.not_mine, "내 업무 아님");

  el.kpiTodo.textContent = String(buckets.todo.length);
  el.kpiProgress.textContent = String(buckets.in_progress.length);
  el.kpiDone.textContent = String(buckets.done.length);
  el.kpiNotMine.textContent = String(buckets.not_mine.length);
  el.countTodo.textContent = String(buckets.todo.length);
  el.countProgress.textContent = String(buckets.in_progress.length);
  el.countDone.textContent = String(buckets.done.length);
  el.countNotMine.textContent = String(buckets.not_mine.length);
}

async function fetchJson(path) {
  const res = await fetch(cacheBust(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function apiHeaders(token, withJson = false) {
  const h = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (withJson) h["Content-Type"] = "application/json";
  return h;
}

async function githubGetContents(path, token) {
  const owner = boardConfig().owner || REPO.owner;
  const name = boardConfig().repo || REPO.name;
  const branch = boardConfig().branch || REPO.branch;
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: apiHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Preferred: trigger Actions workflow that writes data/done.json with GITHUB_TOKEN. */
async function githubDispatchDone(state) {
  const token = getWriteToken();
  if (!token) return { skipped: true };

  const owner = boardConfig().owner || REPO.owner;
  const name = boardConfig().repo || REPO.name;
  const url = `https://api.github.com/repos/${owner}/${name}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify({
      event_type: "board-status",
      client_payload: { ids: state.ids },
    }),
  });
  // 204 No Content on success
  if (res.status !== 204 && !res.ok) {
    const text = await res.text();
    throw new Error(`dispatch ${res.status}: ${text.slice(0, 200)}`);
  }
  return { ok: true, mode: "dispatch" };
}

/** Fallback: direct Contents API PUT (same baked token). */
async function githubPutDone(state) {
  const token = getWriteToken();
  if (!token) return { skipped: true };

  const content = JSON.stringify(state, null, 2) + "\n";
  const b64 = btoa(unescape(encodeURIComponent(content)));

  let sha;
  try {
    const existing = await githubGetContents(DONE_PATH, token);
    sha = existing.sha;
  } catch (err) {
    if (!String(err.message).includes("404")) throw err;
  }

  const owner = boardConfig().owner || REPO.owner;
  const name = boardConfig().repo || REPO.name;
  const branch = boardConfig().branch || REPO.branch;
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${DONE_PATH}`;
  const body = {
    message: `chore(status): sync kanban column state`,
    content: b64,
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: apiHeaders(token, true),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409) {
      const existing = await githubGetContents(DONE_PATH, token);
      body.sha = existing.sha;
      const retry = await fetch(url, {
        method: "PUT",
        headers: apiHeaders(token, true),
        body: JSON.stringify(body),
      });
      if (!retry.ok) {
        const t2 = await retry.text();
        throw new Error(`PUT retry ${retry.status}: ${t2.slice(0, 200)}`);
      }
      return retry.json();
    }
    throw new Error(`PUT ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function persistDone(state) {
  if (writeMode() === "contents") return githubPutDone(state);
  try {
    return await githubDispatchDone(state);
  } catch (err) {
    // If dispatch fails (e.g. token lacks dispatches), fall back to Contents PUT.
    console.warn("dispatch failed, falling back to Contents PUT", err);
    return githubPutDone(state);
  }
}

function queueSync() {
  syncLock = syncLock.then(async () => {
    if (!getWriteToken()) return;
    try {
      await persistDone(doneState);
      toast("data/done.json에 동기화 요청됨");
    } catch (err) {
      console.error(err);
      toast(`동기화 실패: ${err.message}`, true);
    }
  });
  return syncLock;
}

function setStatus(id, status) {
  const at = new Date().toISOString();
  doneState.ids[id] = { status, at };
  saveLocalDone(doneState);
  render();

  const cardAfter = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (cardAfter) cardAfter.classList.add("is-saving");

  const label = STATUS_LABEL[status] || status;
  if (!getWriteToken()) {
    toast(`${label}(으)로 이동 (로컬만)`);
    if (cardAfter) cardAfter.classList.remove("is-saving");
    updateBanner();
    return;
  }

  queueSync().finally(() => {
    const c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) c.classList.remove("is-saving");
  });
}

function allLists() {
  return [el.listTodo, el.listProgress, el.listDone, el.listNotMine];
}

function wireDrag() {
  const lists = allLists();
  const cols = lists.map((list) => list.closest(".col"));

  const onDragStart = (e) => {
    const card = e.target.closest?.(".card");
    if (!card || e.target.closest("a")) {
      e.preventDefault();
      return;
    }
    const id = card.getAttribute("data-id");
    if (!id) {
      e.preventDefault();
      return;
    }
    dragId = id;
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragEnd = (e) => {
    const card = e.target.closest?.(".card");
    if (card) card.classList.remove("is-dragging");
    cols.forEach((c) => c?.classList.remove("is-dragover"));
    dragId = null;
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const col = e.currentTarget.closest(".col");
    cols.forEach((c) => c?.classList.toggle("is-dragover", c === col));
  };

  const onDragLeave = (e) => {
    const col = e.currentTarget.closest(".col");
    if (!col) return;
    if (!col.contains(e.relatedTarget)) col.classList.remove("is-dragover");
  };

  const onDrop = (e) => {
    e.preventDefault();
    const list = e.currentTarget;
    const status = list.getAttribute("data-status");
    cols.forEach((c) => c?.classList.remove("is-dragover"));
    const id = e.dataTransfer.getData("text/plain") || dragId;
    dragId = null;
    if (!id || !status) return;
    const current = (() => {
      const t = tasks.find((x) => x.id === id);
      return t ? bucketFor(t) : null;
    })();
    if (current === status) return;
    setStatus(id, status);
  };

  for (const list of lists) {
    list.addEventListener("dragstart", onDragStart);
    list.addEventListener("dragend", onDragEnd);
    list.addEventListener("dragover", onDragOver);
    list.addEventListener("dragleave", onDragLeave);
    list.addEventListener("drop", onDrop);
  }
}

/* Card context menu: right-click (or "상태 변경" button / long-press) to set status */
let menuEl = null;
let menuTaskId = null;

function currentStatusOf(id) {
  const t = tasks.find((x) => x.id === id);
  return t ? bucketFor(t) : null;
}

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.className = "ctx-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.hidden = true;
  const items = STATUS_ORDER
    .map(
      (st) =>
        `<button type="button" role="menuitem" class="ctx-item" data-status="${st}">` +
        `<span class="ctx-dot ${st}"></span><span class="ctx-label">${STATUS_LABEL[st]}</span>` +
        `<span class="ctx-check">현재</span></button>`
    )
    .join("");
  menuEl.innerHTML = `<div class="ctx-head">상태 변경</div>${items}`;
  document.body.appendChild(menuEl);

  menuEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".ctx-item");
    if (!btn) return;
    const status = btn.getAttribute("data-status");
    const id = menuTaskId;
    closeMenu();
    if (!id || !status) return;
    if (currentStatusOf(id) === status) return;
    setStatus(id, status);
  });
  menuEl.addEventListener("contextmenu", (e) => e.preventDefault());
  return menuEl;
}

function openMenu(id, x, y) {
  const m = ensureMenu();
  menuTaskId = id;
  const cur = currentStatusOf(id);
  m.querySelectorAll(".ctx-item").forEach((b) => {
    const isCur = b.getAttribute("data-status") === cur;
    b.classList.toggle("is-current", isCur);
    b.setAttribute("aria-current", isCur ? "true" : "false");
  });
  document.querySelectorAll(".card.is-menu-open").forEach((c) => c.classList.remove("is-menu-open"));
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) card.classList.add("is-menu-open");

  m.hidden = false;
  m.style.left = "0px";
  m.style.top = "0px";
  const r = m.getBoundingClientRect();
  const pad = 8;
  const left = Math.min(Math.max(pad, x), window.innerWidth - r.width - pad);
  const top = Math.min(Math.max(pad, y), window.innerHeight - r.height - pad);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
  const first = m.querySelector(".ctx-item:not(.is-current)") || m.querySelector(".ctx-item");
  first?.focus({ preventScroll: true });
}

function closeMenu() {
  if (!menuEl || menuEl.hidden) return;
  menuEl.hidden = true;
  menuTaskId = null;
  document.querySelectorAll(".card.is-menu-open").forEach((c) => c.classList.remove("is-menu-open"));
}

function wireContextMenu() {
  const lists = allLists();

  const onContext = (e) => {
    const card = e.target.closest?.(".card");
    if (!card) return;
    if (e.target.closest("a")) return; // keep native menu on links (새 탭 열기 등)
    const id = card.getAttribute("data-id");
    if (!id) return;
    e.preventDefault();
    openMenu(id, e.clientX, e.clientY);
  };

  const onClick = (e) => {
    const btn = e.target.closest?.(".card-menu-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.getAttribute("data-menu-for");
    if (!id) return;
    if (menuEl && !menuEl.hidden && menuTaskId === id) {
      closeMenu();
      return;
    }
    const r = btn.getBoundingClientRect();
    openMenu(id, r.left, r.bottom + 4);
  };

  for (const list of lists) {
    list.addEventListener("contextmenu", onContext);
    list.addEventListener("click", onClick);
  }

  document.addEventListener("pointerdown", (e) => {
    if (!menuEl || menuEl.hidden) return;
    if (menuEl.contains(e.target) || e.target.closest?.(".card-menu-btn")) return;
    closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (!menuEl || menuEl.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...menuEl.querySelectorAll(".ctx-item")];
      const i = items.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  });
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  document.addEventListener("dragstart", closeMenu);
}

function entriesDiffer(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  if (a.status !== b.status) return true;
  const lt = Date.parse(a.at || 0) || 0;
  const rt = Date.parse(b.at || 0) || 0;
  return lt > rt;
}

/** Remove ids already pruned into archive.json (not on the board anymore) so they aren't re-pushed. */
function dropArchived(state) {
  if (!state || !archivedIds.size) return state;
  const out = { ids: {} };
  for (const [id, entry] of Object.entries(state.ids || {})) {
    if (!archivedIds.has(id)) out.ids[id] = entry;
  }
  return out;
}

/** Re-render when a done/not_mine card crosses the 24h mark while the page stays open. */
function startExpiryTimer() {
  setInterval(() => {
    if (dragId || (menuEl && !menuEl.hidden)) return;
    const key = visibleTasks()
      .map((t) => `${t.id}:${bucketFor(t)}`)
      .join("|");
    if (key !== lastVisibleKey) render();
  }, 60 * 1000);
}

async function init() {
  wireDrag();
  wireContextMenu();
  updateBanner();

  try {
    const [tasksDoc, remoteDone, archiveDoc] = await Promise.all([
      fetchJson("data/tasks.json"),
      fetchJson("data/done.json").catch(() => ({ ids: {} })),
      fetchJson("data/archive.json").catch(() => ({ ids: {} })),
    ]);
    tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
    const liveIds = new Set(tasks.map((t) => t.id));
    archivedIds = new Set(
      Object.keys(archiveDoc?.ids || {}).filter((id) => !liveIds.has(id))
    );
    if (tasksDoc.title) el.title.textContent = tasksDoc.title;
    if (tasksDoc.subtitle) el.sub.textContent = tasksDoc.subtitle;
    else if (tasksDoc.updatedAt) el.sub.textContent = `업데이트 ${tasksDoc.updatedAt}`;

    const local = dropArchived(loadLocalDone());
    doneState = dropArchived(mergeDone(remoteDone || { ids: {} }, local));
    saveLocalDone(doneState);
    render();
    startExpiryTimer();

    if (getWriteToken() && local) {
      const remoteIds = normalizeState(remoteDone || { ids: {} }).ids;
      let needsPush = false;
      for (const [id, entry] of Object.entries(local.ids || {})) {
        if (entriesDiffer(entry, remoteIds[id])) {
          needsPush = true;
          break;
        }
      }
      if (needsPush) queueSync();
    }
  } catch (err) {
    console.error(err);
    el.sub.textContent = "할 일을 불러오지 못했습니다";
    toast(String(err.message || err), true);
  }
}

init();
