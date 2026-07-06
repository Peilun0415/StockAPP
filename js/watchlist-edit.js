import {
  loadWatchlist,
  addWatchStock,
  removeWatchStock,
  reorderWatchlist
} from "./watchlist-store.js";
import { subscribeAuthUser, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadStockMasterForSearch, searchStockMaster } from "./stock-master.js";
import { iconClose } from "./icons.js";

const listEl = document.querySelector("#watchlistEditList");
const emptyEl = document.querySelector("#watchlistEditEmpty");
const keywordInput = document.querySelector("#keyword");
const searchSuggestRoot = document.querySelector("#searchSuggest");
const pageLoadingEl = document.querySelector("#pageLoading");
const dragHintEl = document.querySelector("#dragHint");

let items = [];
let currentUid = null;
let stockMaster = [];
let masterLoadingPromise = null;
let dragEl = null;
let touchDragEl = null;
let touchDragging = false;
let touchPendingEl = null;
let touchStartPoint = null;
let touchStartTimer = null;
let suppressNextClick = false;
let touchGhostEl = null;
let touchOffsetY = 0;
let skipFirstAuthReloadForUid = null;
const TOUCH_HOLD_MS = 180;
const TOUCH_MOVE_CANCEL_PX = 10;

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function setDragHint(show) {
  if (!dragHintEl) return;
  if (show) {
    dragHintEl.hidden = false;
    dragHintEl.classList.add("is-visible");
    return;
  }
  dragHintEl.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!dragHintEl.classList.contains("is-visible")) {
      dragHintEl.hidden = true;
    }
  }, 160);
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
  masterLoadingPromise = loadStockMasterForSearch()
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

function clearSearchInput() {
  if (!keywordInput) return;
  keywordInput.value = "";
  hideSuggestions();
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

let suggestRequestId = 0;

async function updateSuggestions(query) {
  const requestId = ++suggestRequestId;
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
  if (requestId !== suggestRequestId) return;

  if (!stockMaster.length) {
    if (!quick) hideSuggestions();
    return;
  }

  const matches = searchStockMaster(stockMaster, q);
  if (requestId !== suggestRequestId) return;
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
        <button type="button" class="watchlist-edit-remove" data-remove="${sym}" aria-label="刪除 ${sym}">${iconClose}</button>
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
    clearSearchInput();
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
  clearSearchInput();
}

listEl?.addEventListener("click", async (event) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
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
  setDragHint(true);
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
  setDragHint(false);
  dragEl = null;
  try {
    await persistOrderFromDom();
  } catch (err) {
    console.warn("儲存排序失敗", err);
    window.alert("儲存排序失敗，請稍後再試。");
    await reloadList();
  }
});

function closestWatchlistItemByPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const li = el.closest?.("li.watchlist-edit-item");
  if (!li || !listEl?.contains(li)) return null;
  return li;
}

function clearTouchPending() {
  if (touchStartTimer) {
    clearTimeout(touchStartTimer);
    touchStartTimer = null;
  }
  touchPendingEl = null;
  touchStartPoint = null;
}

function removeTouchGhost() {
  if (touchGhostEl?.parentNode) {
    touchGhostEl.parentNode.removeChild(touchGhostEl);
  }
  touchGhostEl = null;
}

function updateTouchGhostPosition(touch) {
  if (!touchGhostEl) return;
  const top = touch.clientY - touchOffsetY;
  touchGhostEl.style.top = `${Math.max(8, top)}px`;
}

function createTouchGhost(sourceEl, touch) {
  removeTouchGhost();
  const rect = sourceEl.getBoundingClientRect();
  touchOffsetY = touch.clientY - rect.top;
  const ghost = sourceEl.cloneNode(true);
  ghost.classList.add("watchlist-drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  touchGhostEl = ghost;
}

listEl?.addEventListener("touchstart", (event) => {
  const touch = event.touches?.[0];
  if (!touch) return;
  if (event.target.closest("[data-remove]")) return;
  const li = event.target.closest("li.watchlist-edit-item");
  if (!li || !listEl.contains(li)) return;
  touchPendingEl = li;
  touchStartPoint = { x: touch.clientX, y: touch.clientY };
  touchStartTimer = window.setTimeout(() => {
    touchDragEl = touchPendingEl;
    touchDragging = Boolean(touchDragEl);
    if (touchDragEl) {
      touchDragEl.classList.add("is-dragging");
      touchDragEl.classList.add("is-touch-source");
      createTouchGhost(touchDragEl, touch);
      setDragHint(true);
    }
    clearTouchPending();
  }, TOUCH_HOLD_MS);
});

listEl?.addEventListener("touchmove", (event) => {
  const touch = event.touches?.[0];
  if (!touch) return;
  if (!touchDragging || !touchDragEl) {
    if (!touchPendingEl || !touchStartPoint) return;
    const dx = touch.clientX - touchStartPoint.x;
    const dy = touch.clientY - touchStartPoint.y;
    const moved = Math.hypot(dx, dy);
    if (moved > TOUCH_MOVE_CANCEL_PX) {
      clearTouchPending();
    }
    return;
  }
  event.preventDefault();
  updateTouchGhostPosition(touch);
  const targetLi = closestWatchlistItemByPoint(touch.clientX, touch.clientY);
  if (!targetLi || targetLi === touchDragEl) return;
  const rect = targetLi.getBoundingClientRect();
  const after = touch.clientY > rect.top + rect.height / 2;
  listEl.insertBefore(touchDragEl, after ? targetLi.nextSibling : targetLi);
  const edge = 56;
  if (touch.clientY < edge) {
    window.scrollBy(0, -10);
  } else if (touch.clientY > window.innerHeight - edge) {
    window.scrollBy(0, 10);
  }
}, { passive: false });

async function finishTouchDrag() {
  clearTouchPending();
  if (!touchDragEl) {
    touchDragging = false;
    setDragHint(false);
    return;
  }
  touchDragEl.classList.remove("is-dragging");
  touchDragEl.classList.remove("is-touch-source");
  removeTouchGhost();
  setDragHint(false);
  touchDragEl = null;
  touchDragging = false;
  suppressNextClick = true;
  window.setTimeout(() => {
    suppressNextClick = false;
  }, 250);
  try {
    await persistOrderFromDom();
  } catch (err) {
    console.warn("儲存排序失敗", err);
    window.alert("儲存排序失敗，請稍後再試。");
    await reloadList();
  }
}

listEl?.addEventListener("touchend", () => {
  finishTouchDrag();
});

listEl?.addEventListener("touchcancel", () => {
  finishTouchDrag();
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
    clearSearchInput();
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

    subscribeAuthUser(async (u) => {
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
    });
  } finally {
    if (!currentUid) {
      setPageLoading(false);
    }
  }
}

boot();
