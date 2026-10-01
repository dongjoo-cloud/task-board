const REPO = { owner: "dongjoo-cloud", name: "task-board", branch: "main" };
const DONE_PATH = "data/done.json";
const LS_DONE = "task-board:done";
const LS_PAT = "task-board:pat";

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

/** @type {{ids: Record<string, {done:boolean, at:string}>}} */
let doneState = { ids: {} };
/** @type {Array<any>} */
let tasks = [];
let toastTimer = null;
let syncLock = Promise.resolve();

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
    if (parsed && typeof parsed === "object" && parsed.ids) return parsed;
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

function mergeDone(remote, local) {
  const out = { ids: { ...(remote?.ids || {}) } };
  const localIds = local?.ids || {};
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

function isDone(id) {
  return Boolean(doneState.ids?.[id]?.done);
}

function formatDoneAt(iso) {
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
    "Checkboxes save to <code>localStorage</code> only until you add a fine-grained PAT in Settings. " +
    "With a PAT, Done state is written to <code>data/done.json</code> so the agent can read it.";
}

function renderEmpty(listEl, label) {
  listEl.innerHTML = `<div class="empty">No ${label} items</div>`;
}

function cardHtml(task) {
  const done = isDone(task.id);
  const priority = task.priority || "";
  const source = task.source || "";
  const pills = [];
  if (priority === "new") pills.push('<span class="pill new">NEW</span>');
  if (priority === "still") pills.push('<span class="pill still">STILL</span>');
  if (source) pills.push(`<span class="pill ${source}">${source}</span>`);
  if (done && doneState.ids[task.id]?.at) {
    pills.push(`<span class="pill done-at">${formatDoneAt(doneState.ids[task.id].at)}</span>`);
  }
  const link = task.link
    ? `<a href="${escapeAttr(task.link)}" target="_blank" rel="noopener">open</a>`
    : "";
  return `
    <article class="card ${done ? "is-done" : ""}" data-id="${escapeAttr(task.id)}">
      <input class="check" type="checkbox" ${done ? "checked" : ""} aria-label="Mark done">
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(task.title || task.id)}</span>
          ${pills.join("")}
        </div>
        ${task.summary ? `<p class="summary">${escapeHtml(task.summary)}</p>` : ""}
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

function bucketFor(task) {
  if (isDone(task.id)) return "done";
  if (task.status === "in_progress") return "progress";
  return "todo";
}

function render() {
  const buckets = { todo: [], progress: [], done: [] };
  for (const t of tasks) buckets[bucketFor(t)].push(t);

  const fill = (listEl, items, label) => {
    if (!items.length) {
      renderEmpty(listEl, label);
      return;
    }
    listEl.innerHTML = items.map(cardHtml).join("");
  };

  fill(el.listTodo, buckets.todo, "to do");
  fill(el.listProgress, buckets.progress, "in progress");
  fill(el.listDone, buckets.done, "done");

  el.kpiTodo.textContent = String(buckets.todo.length);
  el.kpiProgress.textContent = String(buckets.progress.length);
  el.kpiDone.textContent = String(buckets.done.length);
  el.countTodo.textContent = String(buckets.todo.length);
  el.countProgress.textContent = String(buckets.progress.length);
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
    // 404 = create new file
    if (!String(err.message).includes("404")) throw err;
  }

  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${DONE_PATH}`;
  const body = {
    message: `chore(done): sync checkbox state`,
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
    // Retry once on SHA conflict
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
      toast("Synced to data/done.json");
    } catch (err) {
      console.error(err);
      toast(`Sync failed: ${err.message}`, true);
    }
  });
  return syncLock;
}

function onToggle(id, checked, card) {
  const at = new Date().toISOString();
  doneState.ids[id] = { done: Boolean(checked), at };
  saveLocalDone(doneState);
  if (card) {
    card.classList.toggle("is-done", checked);
    card.classList.add("is-saving");
  }
  render();
  const cardAfter = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (cardAfter) cardAfter.classList.add("is-saving");

  if (!getPat()) {
    toast(checked ? "Marked done (local only)" : "Unchecked (local only)");
    if (cardAfter) cardAfter.classList.remove("is-saving");
    updateBanner();
    return;
  }

  queueSync().finally(() => {
    const c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) c.classList.remove("is-saving");
  });
}

function wireLists() {
  const handler = (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
    const card = input.closest(".card");
    if (!card) return;
    const id = card.getAttribute("data-id");
    if (!id) return;
    onToggle(id, input.checked, card);
  };
  el.listTodo.addEventListener("change", handler);
  el.listProgress.addEventListener("change", handler);
  el.listDone.addEventListener("change", handler);
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
        toast("Enter a real token", true);
        return;
      }
      setPat(val);
    }
    closeSettings();
    updateBanner();
    if (getPat()) {
      toast("PAT saved — syncing…");
      try {
        await queueSync();
      } catch (_) {}
    } else {
      toast("No PAT — local only");
    }
  });
  el.patClear.addEventListener("click", () => {
    setPat("");
    el.patInput.value = "";
    el.patInput.dataset.dirty = "0";
    updateBanner();
    toast("PAT cleared");
    closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.modal.classList.contains("open")) closeSettings();
  });
}

async function init() {
  wireLists();
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
    else if (tasksDoc.updatedAt) el.sub.textContent = `Updated ${tasksDoc.updatedAt}`;

    const local = loadLocalDone();
    doneState = mergeDone(remoteDone || { ids: {} }, local);
    saveLocalDone(doneState);
    render();

    // If PAT present and local has newer entries, push once on load
    if (getPat() && local) {
      const remoteIds = remoteDone?.ids || {};
      let needsPush = false;
      for (const [id, entry] of Object.entries(local.ids || {})) {
        const r = remoteIds[id];
        const lt = Date.parse(entry?.at || 0) || 0;
        const rt = Date.parse(r?.at || 0) || 0;
        if (!r || lt > rt || Boolean(entry?.done) !== Boolean(r?.done)) {
          needsPush = true;
          break;
        }
      }
      if (needsPush) queueSync();
    }
  } catch (err) {
    console.error(err);
    el.sub.textContent = "Failed to load tasks";
    toast(String(err.message || err), true);
  }
}

init();
