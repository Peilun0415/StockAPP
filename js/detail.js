import { fetchRealtimePrice } from "./market-api.js";
import { fetchCorporateActionHistory, fetchDividendAnnouncementHistory } from "./corporate-actions-api.js";
import { loadMarketCorporateHistory, loadMarketCorporateSummaries, saveManualCorporateEvent } from "./market-corporate-store.js";
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
const pageLoadingEl = document.querySelector("#pageLoading");
const openManualEventBtn = document.querySelector("#openManualEventBtn");
const manualEventDialog = document.querySelector("#manualEventDialog");
const manualEventForm = document.querySelector("#manualEventForm");
const manualEventSymbol = document.querySelector("#manualEventSymbol");
const cancelManualEventBtn = document.querySelector("#cancelManualEventBtn");
const submitManualEventBtn = document.querySelector("#submitManualEventBtn");

const params = new URLSearchParams(window.location.search);
const symbol = (params.get("symbol") || "").toUpperCase();
const stock = createEmptyStock(symbol || "N/A", symbol || "N/A");
let activeRange = 1;

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

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

function calcSpreadRatio(currentPrice, referencePrice) {
  const current = Number(currentPrice);
  const reference = Number(referencePrice);
  if (!Number.isFinite(current) || current <= 0) return null;
  if (!Number.isFinite(reference) || reference <= 0) return null;
  return Number((((current - reference) / current) * 100).toFixed(4));
}

function hasUpcomingEvent(item) {
  return item.nextDividendDate !== "還未公佈" || item.nextRightsDate !== "還未公佈";
}

function isFutureDateYmd(text) {
  if (!text || text === "還未公佈") return false;
  const dt = parseDateYmd(text);
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dt.getTime() > today.getTime();
}

function normalizeDateInputToYmd(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function calcReferencePrice(basePrice, cashDividend, stockDividend, typeLabel) {
  const base = Number(basePrice);
  if (!Number.isFinite(base)) return null;
  const cash = Number.isFinite(Number(cashDividend)) ? Number(cashDividend) : 0;
  const stockDiv = Number.isFinite(Number(stockDividend)) ? Number(stockDividend) : 0;
  const factor = 1 + stockDiv / 10;
  if (typeLabel === "權息") {
    if (factor <= 0) return null;
    return Number(((base - cash) / factor).toFixed(4));
  }
  if (typeLabel === "息") {
    return Number((base - cash).toFixed(4));
  }
  if (typeLabel === "權") {
    if (factor <= 0) return null;
    return Number((base / factor).toFixed(4));
  }
  return null;
}

function getTypeByDividend(cashDividend, stockDividend) {
  const hasCash = cashDividend != null;
  const hasStock = stockDividend != null;
  if (hasCash && hasStock) return "權息";
  if (hasStock) return "權";
  if (hasCash) return "息";
  return "--";
}

function upsertHistoryEvent(event) {
  const next = [...(stock.history || [])];
  const idx = next.findIndex((x) => x.date === event.date && (x.type || "--") === (event.type || "--"));
  if (idx >= 0) {
    next[idx] = event;
  } else {
    next.push(event);
  }
  next.sort((a, b) => (a.date < b.date ? 1 : -1));
  stock.history = next;
}

function resetManualForm() {
  if (!manualEventForm) return;
  manualEventForm.reset();
}

function bindManualEventForm() {
  if (!openManualEventBtn || !manualEventDialog || !manualEventForm) return;
  openManualEventBtn.addEventListener("click", () => {
    if (manualEventSymbol) {
      manualEventSymbol.textContent = `${stock.symbol} ${stock.name || ""}`.trim();
    }
    manualEventDialog.showModal();
  });
  cancelManualEventBtn?.addEventListener("click", () => {
    manualEventDialog.close();
  });
  manualEventDialog.addEventListener("click", (event) => {
    if (event.target === manualEventDialog) {
      manualEventDialog.close();
    }
  });
  manualEventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(manualEventForm);
    const anchorClose = Number(fd.get("anchorClose"));
    const cashRaw = String(fd.get("cashDividend") || "").trim();
    const stockRaw = String(fd.get("stockDividend") || "").trim();
    const dividendDate = normalizeDateInputToYmd(fd.get("dividendDate"));
    const rightsDate = normalizeDateInputToYmd(fd.get("rightsDate"));
    const hasCash = cashRaw !== "";
    const hasStock = stockRaw !== "";
    if (!Number.isFinite(anchorClose) || anchorClose <= 0) {
      alert("請填入有效的除息前股價。");
      return;
    }
    if (!hasCash && !hasStock) {
      alert("現金股利與股票股利至少要填一項。");
      return;
    }
    if (hasCash && !dividendDate) {
      alert("有填現金股利時，請填除息日。");
      return;
    }
    if (hasStock && !rightsDate) {
      alert("有填股票股利時，請填除權日。");
      return;
    }
    const cashDividend = hasCash ? Number(cashRaw) : null;
    const stockDividend = hasStock ? Number(stockRaw) : null;
    if ((hasCash && !Number.isFinite(cashDividend)) || (hasStock && !Number.isFinite(stockDividend))) {
      alert("請確認股利欄位是有效數字。");
      return;
    }
    const payloads = [];
    if (hasCash && hasStock && dividendDate && rightsDate && dividendDate === rightsDate) {
      const type = "權息";
      payloads.push({
        name: stock.name || stock.symbol,
        date: dividendDate,
        type,
        typeRaw: "manual_form",
        cashDividend,
        stockDividend,
        anchorClose,
        referenceAnchorDate: null,
        referencePrice: calcReferencePrice(anchorClose, cashDividend, stockDividend, type),
        referencePriceMode: "manual_anchor_input",
        source: "manual_user_input"
      });
    } else {
      if (hasCash && dividendDate) {
        const type = "息";
        payloads.push({
          name: stock.name || stock.symbol,
          date: dividendDate,
          type,
          typeRaw: "manual_form",
          cashDividend,
          stockDividend: null,
          anchorClose,
          referenceAnchorDate: null,
          referencePrice: calcReferencePrice(anchorClose, cashDividend, null, type),
          referencePriceMode: "manual_anchor_input",
          source: "manual_user_input"
        });
      }
      if (hasStock && rightsDate) {
        const type = "權";
        payloads.push({
          name: stock.name || stock.symbol,
          date: rightsDate,
          type,
          typeRaw: "manual_form",
          cashDividend: null,
          stockDividend,
          anchorClose,
          referenceAnchorDate: null,
          referencePrice: calcReferencePrice(anchorClose, null, stockDividend, type),
          referencePriceMode: "manual_anchor_input",
          source: "manual_user_input"
        });
      }
    }
    if (!payloads.length) {
      alert("請檢查日期與股利欄位。");
      return;
    }
    try {
      if (submitManualEventBtn) {
        submitManualEventBtn.disabled = true;
      }
      await Promise.all(payloads.map((payload) => saveManualCorporateEvent(stock.symbol, payload)));
      payloads.forEach((payload) => {
        upsertHistoryEvent({
          date: payload.date,
          type: payload.type,
          cashDividend: payload.cashDividend,
          stockDividend: payload.stockDividend,
          referencePrice: payload.referencePrice,
          referenceAnchorDate: payload.referenceAnchorDate,
          anchorClose: payload.anchorClose
        });
      });
      renderHistory(stock);
      manualEventDialog.close();
      resetManualForm();
      alert(`已新增 ${payloads.length} 筆歷史除權息資料。`);
    } catch (error) {
      console.error(error);
      alert("寫入失敗，請確認你有 Firestore 寫入權限。");
    } finally {
      if (submitManualEventBtn) {
        submitManualEventBtn.disabled = false;
      }
    }
  });
}

function renderSummary(item) {
  topSymbol.textContent = item.symbol;
  topName.textContent = item.name;

  summaryRoot.innerHTML = `
    <h2>當前價格: ${formatMoney(item.currentPrice)}</h2>
  `;
}

function renderHistory(item) {
  const filtered = getFilteredHistory(item.history || [], activeRange);
  historyTitle.textContent = `歷年除權息紀錄（${rangeText(activeRange)}）`;

  if (!filtered.length) {
    historyRoot.innerHTML = '<p class="empty">此區間尚無歷史除權息資料</p>';
    return;
  }

  historyRoot.innerHTML = filtered.map((h) => {
    const isFutureEvent = isFutureDateYmd(h.date);
    const cashText = h.cashDividend == null ? "還未公佈" : formatMoney(h.cashDividend);
    const stockText = h.stockDividend == null ? "還未公佈" : `${h.stockDividend} 股`;
    const eventPriceText = isFutureEvent
      ? formatMoney(item.currentPrice)
      : (h.anchorClose == null ? "等待數據中" : formatMoney(h.anchorClose));
    const typeLabel = getTypeByDividend(h.cashDividend, h.stockDividend);
    const dynamicRef = calcReferencePrice(item.currentPrice, h.cashDividend, h.stockDividend, typeLabel);
    const effectiveReference = isFutureEvent ? (h.referencePrice ?? dynamicRef) : h.referencePrice;
    const spreadRatio = calcSpreadRatio(item.currentPrice, effectiveReference);
    const ratioText = spreadRatio == null ? "待定" : `${spreadRatio}%`;
    const signal = getSignalByRatio(spreadRatio);
    const tone = spreadRatio == null ? "white" : signal.key;
    const refLine = effectiveReference == null
      ? "除權息參考價: 等待數據中"
      : `除權息參考價: ${formatMoney(effectiveReference)}`;
    const signalLine = effectiveReference == null
      ? "<p>價差比: 待定</p>"
      : `<p>價差比: ${ratioText} <span class="badge ${signal.key}">${signal.icon} ${signal.text}</span></p>`;
    return `
      <article class="history-card ${tone}">
        <span class="timeline-dot ${tone}"></span>
        <p><strong>${h.date}</strong></p>
        <p>現金股利: ${cashText} | 股票股利: ${stockText}</p>
        <p>${isFutureEvent ? "目前價格" : "當時價格"}: ${eventPriceText}</p>
        <p>${refLine}</p>
        ${signalLine}
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
      if (m.referencePrice != null) {
        stock.referencePrice = m.referencePrice;
      }
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
  try {
    setPageLoading(true);
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
    bindManualEventForm();
    await initialize();
  } finally {
    setPageLoading(false);
  }
}

boot();
