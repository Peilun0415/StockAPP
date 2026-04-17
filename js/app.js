import { loadWatchlist, addWatchStock, removeWatchStock } from "./watchlist-store.js";
import { fetchRealtimePrices } from "./market-api.js";
import { fetchAnnualCorporateActions } from "./corporate-actions-api.js";
import { loadMarketCorporateSummaries, loadLatestCompletedEvents } from "./market-corporate-store.js";
import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadStockMasterList, searchStockMaster } from "./stock-master.js";
import { getSignalByRatio, formatMoney, createEmptyStock } from "./stock-utils.js";

const listRoot = document.querySelector("#stockList");
const keywordInput = document.querySelector("#keyword");
const authBtn = document.querySelector("#authBtn");
const authUserEl = document.querySelector("#authUser");
const authAvatarEl = document.querySelector("#authAvatar");
const searchSuggestRoot = document.querySelector("#searchSuggest");
const pageLoadingEl = document.querySelector("#pageLoading");

let allStocks = [];
let currentUid = null;
let loadToken = 0;
let stockMaster = [];
let masterLoadingPromise = null;

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function parseDateYmd(text) {
  const [y, m, d] = String(text || "").split("/").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getUpcomingEventLabel(nextDividendDate, nextRightsDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + 30);
  const candidates = [nextDividendDate, nextRightsDate]
    .map((d) => parseDateYmd(d))
    .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()))
    .filter((d) => d.getTime() >= today.getTime() && d.getTime() <= limit.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  if (!candidates.length) return "";
  const nearest = candidates[0];
  const diffDays = Math.floor((nearest.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "今日除權息";
  if (diffDays === 1) return "明日除權息";
  return `${diffDays} 天內除權息`;
}

function calcReferencePrice(basePrice, cashDividend, stockDividend, hasDividend, hasRights) {
  const base = Number(basePrice);
  if (!Number.isFinite(base)) return null;
  const cash = Number.isFinite(Number(cashDividend)) ? Number(cashDividend) : 0;
  const stock = Number.isFinite(Number(stockDividend)) ? Number(stockDividend) : 0;
  const factor = 1 + stock / 10;

  if (hasDividend && hasRights) {
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return Number(((base - cash) / factor).toFixed(4));
  }
  if (hasDividend) {
    return Number((base - cash).toFixed(4));
  }
  if (hasRights) {
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return Number((base / factor).toFixed(4));
  }
  return null;
}

function calcSpreadRatio(currentPrice, referencePrice) {
  const current = Number(currentPrice);
  const reference = Number(referencePrice);
  if (!Number.isFinite(current) || current <= 0) return null;
  if (!Number.isFinite(reference)) return null;
  return Number((((current - reference) / current) * 100).toFixed(4));
}

function applyPreviousEventInfo(item) {
  const prev = item.previousEvent;
  if (!prev) return { ...item, previousSpreadRatio: null };
  return {
    ...item,
    previousSpreadRatio: calcSpreadRatio(item.currentPrice, prev.referencePrice)
  };
}

function applyCorporateReference(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDateText = item.nextDividendDate !== "還未公佈"
    ? item.nextDividendDate
    : item.nextRightsDate;
  const eventDate = parseDateYmd(eventDateText);
  const hasDividend = item.cashDividend != null;
  const hasRights = item.stockDividend != null;
  const isEventDay = eventDate ? today.getTime() === eventDate.getTime() : false;
  const clearDate = eventDate ? new Date(eventDate) : null;
  if (clearDate) {
    clearDate.setDate(clearDate.getDate() + 1);
  }
  const shouldClear = clearDate && today >= clearDate;

  // 除權息隔天起：首頁清空除權息資訊，參考價改用已固定值
  if (shouldClear) {
    const fixedReference = item.referencePrice ?? null;
    return {
      ...item,
      nextDividendDate: "還未公佈",
      cashDividend: null,
      nextRightsDate: "還未公佈",
      stockDividend: null,
      referenceTitle: "除權息參考價",
      referencePrice: fixedReference,
      spreadRatio: calcSpreadRatio(item.currentPrice, fixedReference)
    };
  }

  // 除權息當天：參考價固定使用前一交易日收盤計算後的值（由後端排程寫入）
  if (isEventDay) {
    const referenceTitle = (hasDividend && hasRights) ? "除權息參考價" : (hasRights ? "除權參考價" : "除息參考價");
    const fixedReference = item.referencePrice ?? null;
    return {
      ...item,
      referenceTitle,
      referencePrice: fixedReference,
      spreadRatio: calcSpreadRatio(item.currentPrice, fixedReference)
    };
  }

  const dynamicRef = calcReferencePrice(
    item.currentPrice,
    item.cashDividend,
    item.stockDividend,
    hasDividend,
    hasRights
  );
  const referenceTitle = (hasDividend && hasRights) ? "除權息參考價" : (hasRights ? "除權參考價" : "除息參考價");
  return {
    ...item,
    referenceTitle,
    referencePrice: dynamicRef ?? item.referencePrice ?? null,
    spreadRatio: calcSpreadRatio(item.currentPrice, dynamicRef ?? item.referencePrice ?? null)
  };
}

function buildStockByWatchlist(watchlist) {
  return watchlist.map((w) => createEmptyStock(w.symbol, w.name || w.symbol));
}

function renderCards(items) {
  if (!items.length) {
    listRoot.innerHTML = '<p class="empty">目前沒有追蹤股，請在上方搜尋股票代號或名稱後加入。</p>';
    return;
  }

  listRoot.innerHTML = items.map((item) => {
    const signal = getSignalByRatio(item.spreadRatio);
    const ratioText = item.spreadRatio == null ? "待定" : `${item.spreadRatio}%`;
    const cashText = item.cashDividend == null ? "還未公佈" : formatMoney(item.cashDividend);
    const rightsText = item.stockDividend == null ? "還未公佈" : `${item.stockDividend} 股`;
    const refText = item.referencePrice == null ? "等待數據中" : formatMoney(item.referencePrice);
    const refTitle = item.referenceTitle || "除息參考價";
    const hasEventDate = item.nextDividendDate !== "還未公佈" || item.nextRightsDate !== "還未公佈";
    const upcomingEventLabel = getUpcomingEventLabel(item.nextDividendDate, item.nextRightsDate);
    const showSignal = item.referencePrice != null;
    const previousRatioText = item.previousSpreadRatio == null ? "待定" : `${item.previousSpreadRatio}%`;
    const previousRefText = item.previousEvent?.referencePrice == null ? "等待數據中" : formatMoney(item.previousEvent.referencePrice);
    const previousDateText = item.previousEvent?.date || "--";
    const showPreviousEventBox = Boolean(item.previousEvent?.date || item.previousEvent?.referencePrice != null);
    const priceSourceText = item.priceSource === "realtime"
      ? "即時"
      : item.priceSource === "prevClose"
        ? "昨收"
        : "收盤";

    return `
      <article class="stock-card" data-symbol="${item.symbol}">
        <button class="delete-btn" type="button" data-delete="${item.symbol}" aria-label="刪除追蹤股">✕</button>
        <a class="card-link" href="./stock.html?symbol=${encodeURIComponent(item.symbol)}">
          <div class="left-col">
            ${upcomingEventLabel ? `<p><span class="event-soon-tag">${upcomingEventLabel}</span></p>` : ""}
            <p class="title">${item.symbol}</p>
            <p>${item.name}</p>
            <p class="price">${formatMoney(item.currentPrice)} <small>(${priceSourceText})</small></p>
          </div>
          <div class="right-col">
            <div class="event-grid">
              <p class="info-chip">除息日期: ${item.nextDividendDate} | 除息額: ${cashText}</p>
              <p class="info-chip">除權日期: ${item.nextRightsDate} | 股數: ${rightsText}</p>
            </div>
            ${hasEventDate ? `<p class="current-ref-line">${refTitle}: ${refText}</p>` : ""}
            ${showSignal ? `<p class="current-signal-line"><span class="badge ${signal.key}">${signal.icon} ${signal.text} | 價差 ${ratioText}</span></p>` : ""}
            ${showPreviousEventBox ? `
              <div class="previous-event-box">
                <p class="previous-event-title">上一期除權息（${previousDateText}）</p>
                <p>參考價: ${previousRefText}</p>
                <p>價差比: ${previousRatioText}</p>
              </div>
            ` : ""}
          </div>
        </a>
      </article>
    `;
  }).join("");
}

async function enrichAnnualCorporateActions(items) {
  if (!items.length) return items;
  const symbols = items.map((x) => x.symbol);
  let marketMap = new Map();
  let previousEventMap = new Map();
  try {
    marketMap = await loadMarketCorporateSummaries(symbols);
  } catch (error) {
    console.warn("讀取市場除權息快取失敗", error);
  }
  try {
    previousEventMap = await loadLatestCompletedEvents(symbols);
  } catch (error) {
    console.warn("讀取上一期除權息資料失敗", error);
  }

  try {
    const actionMap = await fetchAnnualCorporateActions(symbols);
    return items.map((item) => {
      const market = marketMap.get(item.symbol);
      const action = actionMap.get(item.symbol);
      let next = { ...item };

      if (market) {
        next = {
          ...next,
          name: market.name || next.name,
          nextDividendDate: market.nextDividendDate ?? next.nextDividendDate,
          cashDividend: market.cashDividend ?? next.cashDividend,
          nextRightsDate: market.nextRightsDate ?? next.nextRightsDate,
          stockDividend: market.stockDividend ?? next.stockDividend,
          referencePrice: market.referencePrice ?? next.referencePrice
        };
      }
      const previousEvent = previousEventMap.get(item.symbol) ?? null;
      next = applyPreviousEventInfo({ ...next, previousEvent });

      if (!action) return next;
      return applyPreviousEventInfo(applyCorporateReference({
        ...next,
        // 若資料庫沒有值，再補當下 TWT48U
        nextDividendDate: next.nextDividendDate === "還未公佈" ? (action.nextDividendDate ?? next.nextDividendDate) : next.nextDividendDate,
        cashDividend: next.cashDividend == null ? action.cashDividend : next.cashDividend,
        nextRightsDate: next.nextRightsDate === "還未公佈" ? (action.nextRightsDate ?? next.nextRightsDate) : next.nextRightsDate,
        stockDividend: next.stockDividend == null ? action.stockDividend : next.stockDividend
      }));
    });
  } catch (error) {
    console.warn("載入年度除權息資料失敗，改用現有資料", error);
    return items.map((item) => {
      const market = marketMap.get(item.symbol);
      const previousEvent = previousEventMap.get(item.symbol) ?? null;
      if (!market) return applyPreviousEventInfo({ ...item, previousEvent });
      return applyPreviousEventInfo(applyCorporateReference({
        ...item,
        previousEvent,
        name: market.name || item.name,
        nextDividendDate: market.nextDividendDate ?? item.nextDividendDate,
        cashDividend: market.cashDividend ?? item.cashDividend,
        nextRightsDate: market.nextRightsDate ?? item.nextRightsDate,
        stockDividend: market.stockDividend ?? item.stockDividend,
        referencePrice: market.referencePrice ?? item.referencePrice
      }));
    });
  }
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
  const updates = new Map(priceMap.map((x) => [x.symbol, x]));
  allStocks = allStocks.map((item) => {
    const realtime = updates.get(item.symbol);
    if (!realtime || realtime.price == null) {
      return item;
    }
    return applyPreviousEventInfo(applyCorporateReference({ ...item, currentPrice: realtime.price, priceSource: realtime.source || "close" }));
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
  allStocks = await enrichAnnualCorporateActions(buildStockByWatchlist(watchlist));
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
  try {
    setPageLoading(true);
    const returnTo = window.location.pathname + window.location.search;
    const user = await requireAuth(returnTo);
    // 未登入已被跳轉；若 Firebase 未設定則 user 可能為 null
    if (user?.uid) {
      currentUid = user.uid;
    }

    // 背景先載入股票主檔，讓搜尋建議更快出現
    ensureMasterLoaded();

    // 首次進頁：等股票卡片資料載入並渲染後，再關閉 loading
    if (currentUid) {
      await reloadForCurrentUser();
    } else {
      setPageLoading(false);
    }

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
          setPageLoading(true);
          try {
            await reloadForCurrentUser();
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
