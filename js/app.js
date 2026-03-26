import { stockDataset, getSignalByRatio, formatMoney, cloneStock, createCustomStock } from "./data.js";
import { loadWatchlist, addWatchStock, removeWatchStock } from "./watchlist-store.js";
import { fetchRealtimePrices } from "./market-api.js";
import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadStockMasterList, searchStockMaster } from "./stock-master.js";

const listRoot = document.querySelector("#stockList");
const keywordInput = document.querySelector("#keyword");
const authBtn = document.querySelector("#authBtn");
const authUserEl = document.querySelector("#authUser");
const authAvatarEl = document.querySelector("#authAvatar");
const searchSuggestRoot = document.querySelector("#searchSuggest");

let allStocks = [];
let currentUid = null;
let loadToken = 0;
let stockMaster = [];
let masterLoadingPromise = null;

function buildStockByWatchlist(watchlist) {
  const map = new Map(stockDataset.map((s) => [s.symbol, cloneStock(s)]));
  return watchlist.map((w) => {
    const seed = map.get(w.symbol);
    if (seed) {
      return { ...seed, name: w.name || seed.name };
    }
    return createCustomStock(w.symbol, w.name || w.symbol);
  });
}

function renderCards(items) {
  if (!items.length) {
    listRoot.innerHTML = '<p class="empty">找不到符合條件的追蹤股</p>';
    return;
  }

  listRoot.innerHTML = items.map((item) => {
    const signal = getSignalByRatio(item.spreadRatio);
    const ratioText = item.spreadRatio == null ? "待定" : `${item.spreadRatio}%`;
    const cashText = item.cashDividend == null ? "還未公佈" : formatMoney(item.cashDividend);
    const rightsText = item.stockDividend == null ? "還未公佈" : `${item.stockDividend} 股`;
    const refText = item.referencePrice == null ? "等待數據中" : formatMoney(item.referencePrice);

    return `
      <article class="stock-card" data-symbol="${item.symbol}">
        <button class="delete-btn" type="button" data-delete="${item.symbol}" aria-label="刪除追蹤股">✕</button>
        <a class="card-link" href="./stock.html?symbol=${encodeURIComponent(item.symbol)}">
          <div class="left-col">
            <p class="title">${item.symbol}</p>
            <p>${item.name}</p>
            <p class="price">${formatMoney(item.currentPrice)}</p>
          </div>
          <div class="right-col">
            <p><strong>下次除息</strong></p>
            <p>日期: ${item.nextDividendDate} | 除息額: ${cashText}</p>
            <p>下次除權</p>
            <p>日期: ${item.nextRightsDate} | 股數: ${rightsText}</p>
            <p>除息參考價: ${refText}</p>
            <p><span class="badge ${signal.key}">${signal.icon} ${signal.text} | 價差 ${ratioText}</span></p>
          </div>
        </a>
      </article>
    `;
  }).join("");
}

function filterByKeyword(keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) {
    return allStocks;
  }
  return allStocks.filter((s) => (
    s.symbol.toLowerCase().includes(q) || s.name.includes(q)
  ));
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
    .then((items) => {
      stockMaster = items || [];
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
  searchSuggestRoot.innerHTML = matches.map((m) => {
    return `
      <button type="button" class="suggest-item" data-symbol="${escapeHtml(m.symbol)}" data-name="${escapeHtml(m.name)}">
        <span class="suggest-code">${escapeHtml(m.symbol)}</span>
        <span class="suggest-name">${escapeHtml(m.name)}</span>
        <span class="suggest-add">加入</span>
      </button>
    `;
  }).join("");
}

async function updateSuggestions(query) {
  const q = String(query || "").trim();
  if (!q) {
    hideSuggestions();
    return;
  }

  const qUpper = q.toUpperCase();
  // 快速建議：讓你輸入 4 碼代號時立刻看到建議（避免主檔載入失敗/太慢）
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
    // 若主檔載入失敗，就保留快速建議
    if (!quick) {
      hideSuggestions();
    }
    return;
  }

  const matches = searchStockMaster(stockMaster, q);
  showSuggestions(matches);
}

async function refreshRealtimePrice() {
  const priceMap = await fetchRealtimePrices(allStocks.map((s) => s.symbol));
  const updates = new Map(priceMap.map((x) => [x.symbol, x.price]));
  allStocks = allStocks.map((item) => {
    const realtime = updates.get(item.symbol);
    if (realtime == null) {
      return item;
    }
    return { ...item, currentPrice: realtime };
  });
  // 搜尋框只用來「新增追蹤」，不拿來篩選追蹤清單內容
  renderCards(allStocks);
}

async function reloadForCurrentUser() {
  const token = ++loadToken;
  const watchlist = await loadWatchlist(currentUid);
  if (token !== loadToken) {
    return;
  }
  allStocks = buildStockByWatchlist(watchlist);
  // 搜尋框只用來「新增追蹤」，不拿來篩選追蹤清單內容
  renderCards(allStocks);
  await refreshRealtimePrice();
}

async function addFromQuery(qRaw) {
  const q = String(qRaw || "").trim();
  if (!q) {
    alert("請先在搜尋框輸入股號或公司名稱。");
    keywordInput.focus();
    return;
  }
  const qUpper = q.toUpperCase();
  const quickBest = (() => {
    if (/^\d{4}$/.test(qUpper)) return { symbol: `${qUpper}.TW`, name: `${qUpper}.TW` };
    if (/^\d{4}\.TW$/.test(qUpper)) return { symbol: qUpper, name: qUpper };
    return null;
  })();

  // 代號型輸入：主檔載入失敗/過慢時也要能直接加入
  if (quickBest && (!stockMaster.length && !masterLoadingPromise)) {
    await addWatchStock({ symbol: quickBest.symbol, name: quickBest.name }, currentUid);
    await reloadForCurrentUser();
    hideSuggestions();
    return;
  }

  await ensureMasterLoaded();
  const matches = stockMaster.length ? searchStockMaster(stockMaster, q) : [];
  const best = matches?.[0] || quickBest;
  if (!best) {
    alert("找不到符合的股票代號/名稱。");
    return;
  }

  await addWatchStock({ symbol: best.symbol, name: best.name }, currentUid);
  await reloadForCurrentUser();
  hideSuggestions();
}

keywordInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const qRaw = keywordInput.value;
  await addFromQuery(qRaw);
});

listRoot.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-delete]");
  if (!btn) {
    return;
  }
  event.preventDefault();
  const symbol = btn.getAttribute("data-delete");
  if (!window.confirm(`確定刪除 ${symbol} 追蹤嗎？`)) {
    return;
  }
  await removeWatchStock(symbol, currentUid);
  await reloadForCurrentUser();
});

keywordInput.addEventListener("input", (event) => {
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
    await reloadForCurrentUser();
    keywordInput.value = symbol;
    hideSuggestions();
  });

  // 點擊空白處收合
  document.addEventListener("click", (event) => {
    if (!searchSuggestRoot || searchSuggestRoot.hidden) return;
    const inSuggest = event.target && searchSuggestRoot.contains(event.target);
    const inInput = event.target && keywordInput.contains(event.target);
    if (!inSuggest && !inInput) {
      hideSuggestions();
    }
  });
}

async function boot() {
  const returnTo = window.location.pathname + window.location.search;
  const user = await requireAuth(returnTo);
  // 未登入已被跳轉；若 Firebase 未設定則 user 可能為 null
  if (user?.uid) {
    currentUid = user.uid;
  }

  // 背景先載入股票主檔，讓搜尋建議更快出現
  ensureMasterLoaded();

  initGoogleAuthUI({
    authBtn,
    authUserEl,
    avatarEl: authAvatarEl,
    onUserChanged: async (u) => {
      currentUid = u?.uid ?? null;
      if (!u && isAuthAvailable()) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (currentUid) {
        await reloadForCurrentUser();
      }
    }
  });
}

boot();
