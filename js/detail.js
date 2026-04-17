import { fetchRealtimePrice } from "./market-api.js";
import { fetchCorporateActionHistory, fetchDividendAnnouncementHistory } from "./corporate-actions-api.js";
import { loadMarketCorporateHistory, loadMarketCorporateSummaries } from "./market-corporate-store.js";
import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { getSignalByRatio, formatMoney, createEmptyStock } from "./stock-utils.js";
import { loadStockMasterList } from "./stock-master.js";

const topSymbol = document.querySelector("#detailSymbolTop");
const topName = document.querySelector("#detailNameTop");
const summaryRoot = document.querySelector("#stockSummary");
const historyRoot = document.querySelector("#historyList");
const historyTitle = document.querySelector("#historyTitle");
const rangePills = document.querySelector("#rangePills");
const authBtn = document.querySelector("#authBtn");
const authUserEl = document.querySelector("#authUser");
const authAvatarEl = document.querySelector("#authAvatar");

const params = new URLSearchParams(window.location.search);
const symbol = (params.get("symbol") || "").toUpperCase();
const stock = createEmptyStock(symbol || "N/A", symbol || "N/A");
let activeRange = 1;

function parseDateYmd(text) {
  const [y, m, d] = text.split("/").map((x) => Number(x));
  return new Date(y, m - 1, d);
}

function getFilteredHistory(history, range) {
  if (range === "all") {
    return history;
  }
  const years = Number(range);
  const now = new Date();
  const limit = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  return history.filter((h) => parseDateYmd(h.date) >= limit);
}

function rangeText(range) {
  if (range === "all") {
    return "全部";
  }
  return `近 ${range} 年`;
}

function renderSummary(item) {
  const signal = getSignalByRatio(item.spreadRatio);
  const ratioText = item.spreadRatio == null ? "待定" : `${item.spreadRatio}%`;
  const refText = item.referencePrice == null ? "等待數據中" : formatMoney(item.referencePrice);
  const signalText = item.spreadRatio == null ? "⚪ 待定" : `${signal.icon} ${signal.text}`;

  topSymbol.textContent = item.symbol;
  topName.textContent = item.name;

  summaryRoot.innerHTML = `
    <h1>${item.name} (${item.symbol})</h1>
    <h2>當前價格: ${formatMoney(item.currentPrice)}</h2>
    <p>除權息參考基準價: ${refText}</p>
    <p>當前價差比: ${ratioText}</p>
    <p><span class="badge ${signal.key}">${signalText}</span></p>
  `;
}

function renderHistory(item) {
  const filtered = getFilteredHistory(item.history, activeRange);
  historyTitle.textContent = `歷年除權息紀錄（${rangeText(activeRange)}）`;

  if (!filtered.length) {
    historyRoot.innerHTML = '<p class="empty">此區間尚無歷史除權息資料</p>';
    return;
  }

  historyRoot.innerHTML = filtered.map((h) => {
    const cashText = h.cashDividend == null ? "還未公佈" : formatMoney(h.cashDividend);
    const stockText = h.stockDividend == null ? "還未公佈" : `${h.stockDividend} 股`;
    return `
      <article class="history-card white">
        <span class="timeline-dot white"></span>
        <p><strong>${h.date} 除權息完畢</strong></p>
        <p>類型: ${h.type || "--"}</p>
        <p>現金股利: ${cashText} | 股票股利: ${stockText}</p>
      </article>
    `;
  }).join("");
}

rangePills.addEventListener("click", (event) => {
  const btn = event.target.closest(".pill");
  if (!btn) {
    return;
  }
  rangePills.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  activeRange = btn.dataset.range;
  renderHistory(stock);
});

async function initialize() {
  const returnTo = window.location.pathname + window.location.search;
  await requireAuth(returnTo);

  try {
    const master = await loadStockMasterList();
    const found = master.find((x) => x.symbol === stock.symbol);
    if (found?.name) {
      stock.name = found.name;
    }
  } catch (error) {
    console.warn("載入股票主檔失敗，明細名稱改用代號", error);
  }

  try {
    const sumMap = await loadMarketCorporateSummaries([stock.symbol]);
    const m = sumMap.get(stock.symbol);
    if (m) {
      stock.name = m.name || stock.name;
      stock.nextDividendDate = m.nextDividendDate ?? stock.nextDividendDate;
      stock.nextRightsDate = m.nextRightsDate ?? stock.nextRightsDate;
      stock.cashDividend = m.cashDividend ?? stock.cashDividend;
      stock.stockDividend = m.stockDividend ?? stock.stockDividend;
    }
  } catch (error) {
    console.warn("讀取市場除權息摘要失敗", error);
  }

  const realtime = await fetchRealtimePrice(stock.symbol);
  if (realtime != null) {
    stock.currentPrice = realtime;
  }
  try {
    stock.history = await loadMarketCorporateHistory(stock.symbol);
    if (!stock.history.length) {
      stock.history = await fetchCorporateActionHistory(stock.symbol, 10);
    }
    if (!stock.history.length) {
      stock.history = await fetchDividendAnnouncementHistory(stock.symbol);
    }
  } catch (error) {
    console.warn("載入歷史除權息資料失敗，改用預設資料", error);
  }
  renderSummary(stock);
  renderHistory(stock);
}

async function boot() {
  initGoogleAuthUI({
    authBtn,
    authUserEl,
    avatarEl: authAvatarEl,
    onUserChanged: (u) => {
      // 登出後直接回到登入頁，避免在未登入狀態停留
      if (!u && isAuthAvailable()) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
      }
    }
  });
  await initialize();
}

boot();
