import { stockDataset, getSignalByRatio, formatMoney, cloneStock, createCustomStock } from "./data.js";
import { loadWatchlist, addWatchStock, removeWatchStock } from "./watchlist-store.js";
import { fetchRealtimePrices } from "./market-api.js";

const listRoot = document.querySelector("#stockList");
const keywordInput = document.querySelector("#keyword");
const addBtn = document.querySelector("#addStockBtn");

let allStocks = [];

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
  renderCards(filterByKeyword(keywordInput.value));
}

async function initialize() {
  const watchlist = await loadWatchlist();
  allStocks = buildStockByWatchlist(watchlist);
  renderCards(allStocks);
  await refreshRealtimePrice();
}

addBtn.addEventListener("click", async () => {
  const symbolInput = window.prompt("輸入股票代號（例如 2330.TW）");
  if (!symbolInput) {
    return;
  }
  const symbol = symbolInput.trim().toUpperCase();
  const nameInput = window.prompt("輸入股票名稱（可留空）");
  const name = (nameInput || symbol).trim() || symbol;
  await addWatchStock({ symbol, name });
  const watchlist = await loadWatchlist();
  allStocks = buildStockByWatchlist(watchlist);
  renderCards(filterByKeyword(keywordInput.value));
  await refreshRealtimePrice();
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
  await removeWatchStock(symbol);
  const watchlist = await loadWatchlist();
  allStocks = buildStockByWatchlist(watchlist);
  renderCards(filterByKeyword(keywordInput.value));
});

keywordInput.addEventListener("input", (event) => {
  renderCards(filterByKeyword(event.target.value));
});

initialize();
