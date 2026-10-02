const REPO = { owner: "dongjoo-cloud", name: "task-board", branch: "main" };
const DONE_PATH = "data/done.json";
const LS_DONE = "task-board:done";
const LS_PAT = "task-board:pat";

/** Canonical column statuses persisted in done.json */
const STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
};

const STATUS_LABEL = {
  todo: "할 일",
  in_progress: "진행 중",
  done: "완료",
};

const el = {
  title: document.getElementById("board-title"),
  sub: document.getElementById("board-sub"),
  banner: document.getElementById("setup-banner"),
  kpiTodo: document.getElementById("kpi-todo"),
  kpiProgress: document.getElementById("kpi-progress"),
  kpiDone: document.getElementById("kpi-done"),
  countTodo: document.getElementById("count-todo"),
  countProgress: document.getElementById("count-progress"),
  countDone: document.getElementById("count-done"),
  listTodo: document.getElementById("list-todo"),
  listProgress: document.getElementById("list-progress"),
  listDone: document.getElementById("list-done"),
  toast: document.getElementById("toast"),
  settingsBtn: document.getElementById("settings-btn"),
  modal: document.getElementById("settings-modal"),
  patInput: document.getElementById("pat-input"),
  patSave: document.getElementById("pat-save"),
  patCancel: document.getElementById("pat-cancel"),
  patClear: document.getElementById("pat-clear"),
};

/** @type {{ids: Record<string, {status:string, at:string, done?:boolean}>}} */
let doneState = { ids: {} };
/** @type {Array<any>} */
let tasks = [];
let toastTimer = null;
let syncLock = Promise.resolve();
let dragId = null;

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

function getPat() {
  return (localStorage.getItem(LS_PAT) || "").trim();
}

function setPat(token) {
  if (!token) localStorage.removeItem(LS_PAT);
  else localStorage.setItem(LS_PAT, token.trim());
}

/** Normalize legacy {done:boolean} entries into {status}. */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  let status = entry.status;
  if (status !== STATUS.TODO && status !== STATUS.IN_PROGRESS && status !== STATUS.DONE) {
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
  const hasPat = Boolean(getPat());
  if (hasPat) {
    el.banner.hidden = true;
    el.banner.textContent = "";
    return;
  }
  el.banner.hidden = false;
  el.banner.className = "banner warn";
  el.banner.innerHTML =
    "열 이동은 설정에서 fine-grained PAT를 넣기 전까지는 <code>localStorage</code>에만 저장됩니다. " +
    "PAT가 있으면 칸반 상태가 <code>data/done.json</code>에 기록되어 에이전트가 읽을 수 있습니다.";
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
  if (doneState.ids[task.id]?.at) {
    pills.push(`<span class="pill status-at">${formatStatusAt(doneState.ids[task.id].at)}</span>`);
  }
  const body = task["내용"] || task.summary || "";
  const action = task["액션"] || task.action || "";
  const link = task.link
    ? `<a href="${escapeAttr(task.link)}" target="_blank" rel="noopener" draggable="false">${linkLabel(task)}</a>`
    : "";
  return `
    <article class="card ${col === STATUS.DONE ? "is-done" : ""}" data-id="${escapeAttr(task.id)}" draggable="true">
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
  return STATUS.TODO;
}

function bucketFor(task) {
  const override = getOverrideStatus(task.id);
  if (override) return override;
  return normalizeTaskStatus(task.status);
}

function render() {
  const buckets = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) {
    const b = bucketFor(t);
    buckets[b].push(t);
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

  el.kpiTodo.textContent = String(buckets.todo.length);
  el.kpiProgress.textContent = String(buckets.in_progress.length);
  el.kpiDone.textContent = String(buckets.done.length);
  el.countTodo.textContent = String(buckets.todo.length);
  el.countProgress.textContent = String(buckets.in_progress.length);
  el.countDone.textContent = String(buckets.done.length);
}

async function fetchJson(path) {
  const res = await fetch(cacheBust(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function githubGetContents(path) {
  const pat = getPat();
  if (!pat) throw new Error("No PAT");
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${encodeURIComponent(REPO.branch)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${pat}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function githubPutDone(state) {
  const pat = getPat();
  if (!pat) return { skipped: true };

  const content = JSON.stringify(state, null, 2) + "\n";
  const b64 = btoa(unescape(encodeURIComponent(content)));

  let sha;
  try {
    const existing = await githubGetContents(DONE_PATH);
    sha = existing.sha;
  } catch (err) {
    if (!String(err.message).includes("404")) throw err;
  }

  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${DONE_PATH}`;
  const body = {
    message: `chore(status): sync kanban column state`,
    content: b64,
    branch: REPO.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${pat}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409) {
      const existing = await githubGetContents(DONE_PATH);
      body.sha = existing.sha;
      const retry = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${pat}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
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

function queueSync() {
  syncLock = syncLock.then(async () => {
    if (!getPat()) return;
    try {
      await githubPutDone(doneState);
      toast("data/done.json에 동기화됨");
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
  if (!getPat()) {
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

function wireDrag() {
  const lists = [el.listTodo, el.listProgress, el.listDone];
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
    // Only clear when leaving the column entirely
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

function openSettings() {
  el.patInput.value = getPat() ? "••••••••••••" : "";
  el.patInput.dataset.dirty = "0";
  el.modal.hidden = false;
  el.modal.classList.add("open");
  el.patInput.focus();
}
function closeSettings() {
  el.modal.classList.remove("open");
  el.modal.hidden = true;
}

function wireSettings() {
  el.settingsBtn.addEventListener("click", openSettings);
  el.patCancel.addEventListener("click", closeSettings);
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) closeSettings();
  });
  el.patInput.addEventListener("input", () => {
    el.patInput.dataset.dirty = "1";
  });
  el.patSave.addEventListener("click", async () => {
    const dirty = el.patInput.dataset.dirty === "1";
    const val = el.patInput.value.trim();
    if (dirty) {
      if (!val || val.startsWith("••")) {
        toast("실제 토큰을 입력하세요", true);
        return;
      }
      setPat(val);
    }
    closeSettings();
    updateBanner();
    if (getPat()) {
      toast("PAT 저장됨 — 동기화 중…");
      try {
        await queueSync();
      } catch (_) {}
    } else {
      toast("PAT 없음 — 로컬만");
    }
  });
  el.patClear.addEventListener("click", () => {
    setPat("");
    el.patInput.value = "";
    el.patInput.dataset.dirty = "0";
    updateBanner();
    toast("PAT 지워짐");
    closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.modal.classList.contains("open")) closeSettings();
  });
}

function entriesDiffer(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  if (a.status !== b.status) return true;
  const lt = Date.parse(a.at || 0) || 0;
  const rt = Date.parse(b.at || 0) || 0;
  return lt > rt;
}

async function init() {
  wireDrag();
  wireSettings();
  updateBanner();

  try {
    const [tasksDoc, remoteDone] = await Promise.all([
      fetchJson("data/tasks.json"),
      fetchJson("data/done.json").catch(() => ({ ids: {} })),
    ]);
    tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
    if (tasksDoc.title) el.title.textContent = tasksDoc.title;
    if (tasksDoc.subtitle) el.sub.textContent = tasksDoc.subtitle;
    else if (tasksDoc.updatedAt) el.sub.textContent = `업데이트 ${tasksDoc.updatedAt}`;

    const local = loadLocalDone();
    doneState = mergeDone(remoteDone || { ids: {} }, local);
    saveLocalDone(doneState);
    render();

    if (getPat() && local) {
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
