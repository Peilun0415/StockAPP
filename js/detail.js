import { stockDataset, getSignalByRatio, formatMoney, cloneStock } from "./data.js";
import { fetchRealtimePrice } from "./market-api.js";
import { initGoogleAuthUI } from "./auth.js";
import { requireAuth } from "./auth-guard.js";

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
const stock = cloneStock(stockDataset.find((s) => s.symbol === symbol) || stockDataset[0]);
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
    const signal = getSignalByRatio(h.ratio);
    return `
      <article class="history-card ${signal.key}">
        <span class="timeline-dot ${signal.key}"></span>
        <p><strong>${h.date} 除權息完畢</strong></p>
        <p>現金: ${formatMoney(h.cash)} | 當時價格: ${formatMoney(h.currentPrice)}</p>
        <p>參考價: ${formatMoney(h.referencePrice)} | 價差: ${h.ratio}%</p>
        <p><span class="badge ${signal.key}">${signal.icon} ${signal.text}</span></p>
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

  const realtime = await fetchRealtimePrice(stock.symbol);
  if (realtime != null) {
    stock.currentPrice = realtime;
  }
  renderSummary(stock);
  renderHistory(stock);
}

async function boot() {
  initGoogleAuthUI({
    authBtn,
    authUserEl,
    avatarEl: authAvatarEl,
    onUserChanged: () => {
      // 此頁目前只顯示登入狀態；追蹤清單儲存已在首頁完成
    }
  });
  await initialize();
}

boot();
