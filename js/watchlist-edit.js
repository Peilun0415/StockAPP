import {
  loadWatchlist,
  addWatchStock,
  removeWatchStock,
  reorderWatchlist
} from "./watchlist-store.js";
import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadStockMasterList, searchStockMaster } from "./stock-master.js";

const listEl = document.querySelector("#watchlistEditList");
const emptyEl = document.querySelector("#watchlistEditEmpty");
const keywordInput = document.querySelector("#keyword");
const searchSuggestRoot = document.querySelector("#searchSuggest");
const authBtn = document.querySelector("#authBtn");
const authAvatarEl = document.querySelector("#authAvatar");
const pageLoadingEl = document.querySelector("#pageLoading");

let items = [];
let currentUid = null;
let stockMaster = [];
let masterLoadingPromise = null;
let dragEl = null;
let skipFirstAuthReloadForUid = null;

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function ensureMasterLoaded() {
  if (stockMaster.length) return stockMaster;
  if (masterLoadingPromise) return masterLoadingPromise;
  masterLoadingPromise = loadStockMasterList()
    .then((loaded) => {
      stockMaster = loaded || [];
      return stockMaster;
    })
    .catch((err) => {
      console.warn("載入股票主檔失敗", err);
      stockMaster = [];
      return stockMaster;
    });
  return masterLoadingPromise;
}

function hideSuggestions() {
  if (!searchSuggestRoot) return;
  searchSuggestRoot.hidden = true;
  searchSuggestRoot.innerHTML = "";
}

function showSuggestions(matches) {
  if (!searchSuggestRoot) return;
  if (!matches?.length) {
    hideSuggestions();
    return;
  }
  searchSuggestRoot.hidden = false;
  searchSuggestRoot.innerHTML = matches.map((m) => `
      <button type="button" class="suggest-item" data-symbol="${escapeHtml(m.symbol)}" data-name="${escapeHtml(m.name)}">
        <span class="suggest-code">${escapeHtml(m.symbol)}</span>
        <span class="suggest-name">${escapeHtml(m.name)}</span>
        <span class="suggest-add">加入</span>
      </button>
    `).join("");
}

async function updateSuggestions(query) {
  const q = String(query || "").trim();
  if (!q) {
    hideSuggestions();
    return;
  }

  const qUpper = q.toUpperCase();
  const quick = (() => {
    if (/^\d{4}$/.test(qUpper)) {
      return { symbol: `${qUpper}.TW`, name: "（等待載入）" };
    }
    if (/^\d{4}\.TW$/.test(qUpper)) {
      return { symbol: qUpper, name: "（等待載入）" };
    }
    return null;
  })();

  if (quick) {
    showSuggestions([quick]);
  }

  await ensureMasterLoaded();
  if (!stockMaster.length) {
    if (!quick) hideSuggestions();
    return;
  }

  const matches = searchStockMaster(stockMaster, q);
  showSuggestions(matches);
}

function collectOrderFromDom() {
  return [...listEl.querySelectorAll("li.watchlist-edit-item")].map((li) => ({
    symbol: li.dataset.symbol,
    name: li.dataset.name || li.dataset.symbol
  }));
}

async function persistOrderFromDom() {
  items = collectOrderFromDom();
  await reorderWatchlist(items, currentUid);
}

function renderList() {
  if (!listEl || !emptyEl) return;
  if (!items.length) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = items.map((row) => {
    const sym = escapeHtml(row.symbol);
    const name = escapeHtml(row.name || row.symbol);
    return `
      <li class="watchlist-edit-item"
          draggable="true"
          data-symbol="${sym}"
          data-name="${name}">
        <span class="watchlist-drag-handle" aria-hidden="true">⋮⋮</span>
        <div class="watchlist-edit-main">
          <p class="watchlist-edit-line">
            <span class="watchlist-edit-name">${name}</span>
            <span class="watchlist-edit-symbol">${sym}</span>
          </p>
        </div>
        <button type="button" class="watchlist-edit-remove" data-remove="${sym}" aria-label="刪除 ${sym}">✕</button>
      </li>
    `;
  }).join("");
}

async function reloadList() {
  items = await loadWatchlist(currentUid);
  renderList();
}

async function addFromQuery(qRaw) {
  const q = String(qRaw || "").trim();
  if (!q) {
    window.alert("請先輸入股號或公司名稱。");
    keywordInput?.focus();
    return;
  }
  const qUpper = q.toUpperCase();
  const quickBest = (() => {
    if (/^\d{4}$/.test(qUpper)) return { symbol: `${qUpper}.TW`, name: `${qUpper}.TW` };
    if (/^\d{4}\.TW$/.test(qUpper)) return { symbol: qUpper, name: qUpper };
    return null;
  })();

  if (quickBest && (!stockMaster.length && !masterLoadingPromise)) {
    await addWatchStock({ symbol: quickBest.symbol, name: quickBest.name }, currentUid);
    await reloadList();
    hideSuggestions();
    return;
  }

  await ensureMasterLoaded();
  const matches = stockMaster.length ? searchStockMaster(stockMaster, q) : [];
  const best = matches?.[0] || quickBest;
  if (!best) {
    window.alert("找不到符合的股票代號/名稱。");
    return;
  }

  await addWatchStock({ symbol: best.symbol, name: best.name }, currentUid);
  await reloadList();
  hideSuggestions();
}

listEl?.addEventListener("click", async (event) => {
  const del = event.target.closest("[data-remove]");
  if (del) {
    event.preventDefault();
    const symbol = del.getAttribute("data-remove");
    if (!symbol || !window.confirm(`確定刪除 ${symbol} 追蹤嗎？`)) return;
    await removeWatchStock(symbol, currentUid);
    await reloadList();
    return;
  }

});

listEl?.addEventListener("dragstart", (event) => {
  const li = event.target.closest("li.watchlist-edit-item");
  if (!li || !listEl.contains(li)) return;
  dragEl = li;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", li.dataset.symbol || "");
  li.classList.add("is-dragging");
});

listEl?.addEventListener("dragover", (event) => {
  if (!dragEl) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const li = event.target.closest("li.watchlist-edit-item");
  if (!li || li === dragEl || !listEl.contains(li)) return;
  const rect = li.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  listEl.insertBefore(dragEl, after ? li.nextSibling : li);
});

listEl?.addEventListener("dragend", async () => {
  if (dragEl) {
    dragEl.classList.remove("is-dragging");
  }
  dragEl = null;
  try {
    await persistOrderFromDom();
  } catch (err) {
    console.warn("儲存排序失敗", err);
    window.alert("儲存排序失敗，請稍後再試。");
    await reloadList();
  }
});

keywordInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await addFromQuery(keywordInput.value);
});

keywordInput?.addEventListener("input", (event) => {
  const q = event.target.value;
  updateSuggestions(q);
  if (!q || !q.trim()) {
    hideSuggestions();
  }
});

if (searchSuggestRoot) {
  searchSuggestRoot.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-symbol]");
    if (!btn) return;
    const symbol = btn.getAttribute("data-symbol");
    const name = btn.getAttribute("data-name") || symbol;
    if (!symbol) return;
    await addWatchStock({ symbol, name }, currentUid);
    await reloadList();
    keywordInput.value = symbol;
    hideSuggestions();
  });

  document.addEventListener("click", (event) => {
    if (!searchSuggestRoot || searchSuggestRoot.hidden) return;
    const inSuggest = event.target && searchSuggestRoot.contains(event.target);
    const inInput = event.target && keywordInput?.contains(event.target);
    if (!inSuggest && !inInput) {
      hideSuggestions();
    }
  });
}

async function boot() {
  try {
    setPageLoading(true);
    const returnTo = window.location.pathname + window.location.search;
    const user = await requireAuth(returnTo);
    if (user?.uid) {
      currentUid = user.uid;
    }

    ensureMasterLoaded();

    if (currentUid || !isAuthAvailable()) {
      await reloadList();
      if (currentUid) {
        skipFirstAuthReloadForUid = currentUid;
      }
    } else {
      setPageLoading(false);
    }

    initGoogleAuthUI({
      authBtn,
      authUserEl: null,
      avatarEl: authAvatarEl,
      appBarOnlyLogout: true,
      onUserChanged: async (u) => {
        const nextUid = u?.uid ?? null;
        if (nextUid && skipFirstAuthReloadForUid && nextUid === skipFirstAuthReloadForUid) {
          skipFirstAuthReloadForUid = null;
          currentUid = nextUid;
          setPageLoading(false);
          return;
        }
        skipFirstAuthReloadForUid = null;
        currentUid = nextUid;
        if (!u && isAuthAvailable()) {
          const rt = window.location.pathname + window.location.search;
          window.location.replace(`./login.html?redirect=${encodeURIComponent(rt)}`);
          return;
        }
        if (currentUid || !isAuthAvailable()) {
          setPageLoading(true);
          try {
            await reloadList();
          } finally {
            setPageLoading(false);
          }
        } else {
          setPageLoading(false);
        }
      }
    });
  } finally {
    if (!currentUid) {
      setPageLoading(false);
    }
  }
}

boot();
