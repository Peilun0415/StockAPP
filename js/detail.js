import { fetchRealtimePrice } from "./market-api.js";
import { fetchCorporateActionHistory, fetchDividendAnnouncementHistory } from "./corporate-actions-api.js";
import {
  loadMarketCorporateHistory,
  loadMarketCorporateSummaries,
  saveManualCorporateEvent,
  deleteManualCorporateEvent
} from "./market-corporate-store.js";
import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { getSignalByRatio, formatMoney, createEmptyStock } from "./stock-utils.js";
import { loadStockMasterList } from "./stock-master.js";
import {
  initDateSegmentFields,
  resetDateFieldsInForm,
  setDateFieldReadOnly,
  setDateFieldValue
} from "./date-segment-field.js";

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
const editHistoryDialog = document.querySelector("#editHistoryDialog");
const editHistoryForm = document.querySelector("#editHistoryForm");
const editHistorySymbol = document.querySelector("#editHistorySymbol");
const cancelEditHistoryBtn = document.querySelector("#cancelEditHistoryBtn");
const submitEditHistoryBtn = document.querySelector("#submitEditHistoryBtn");

const params = new URLSearchParams(window.location.search);
const symbol = (params.get("symbol") || "").toUpperCase();
const stock = createEmptyStock(symbol || "N/A", symbol || "N/A");
let activeRange = 1;
let canManageHistory = false;

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

function normalizeYmdToDateInput(value) {
  const t = String(value || "").trim();
  const m = t.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
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

function findHistoryEvent(date, type) {
  return (stock.history || []).find((x) => x.date === date && (x.type || "--") === (type || "--")) || null;
}

function removeHistoryEvent(date, type) {
  stock.history = (stock.history || []).filter((x) => !(x.date === date && (x.type || "--") === (type || "--")));
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
  resetDateFieldsInForm(manualEventForm);
  const rightsWrap = manualEventForm.querySelector('.date-segment-field[data-date-name="rightsDate"]');
  setDateFieldReadOnly(rightsWrap, false);
  const rightsAnchor = manualEventForm.elements.rightsAnchorClose;
  if (rightsAnchor) rightsAnchor.readOnly = false;
}

function bindManualEventForm() {
  if (!openManualEventBtn || !manualEventDialog || !manualEventForm) return;
  const syncRightsWithDividendCb = manualEventForm.querySelector("#syncRightsWithDividendDate");
  const dividendHidden = manualEventForm.querySelector('input[name="dividendDate"]');
  const rightsDateWrap = manualEventForm.querySelector('.date-segment-field[data-date-name="rightsDate"]');
  const dividendAnchorInput = manualEventForm.elements.anchorClose;
  const rightsAnchorInput = manualEventForm.elements.rightsAnchorClose;

  function applyRightsDateFromDividend() {
    if (!syncRightsWithDividendCb?.checked || !dividendHidden || !rightsDateWrap) return;
    setDateFieldValue(rightsDateWrap, dividendHidden.value);
  }

  function applyRightsAnchorFromDividend() {
    if (!syncRightsWithDividendCb?.checked || !dividendAnchorInput || !rightsAnchorInput) return;
    rightsAnchorInput.value = dividendAnchorInput.value;
  }

  function setRightsSyncedUi(checked) {
    setDateFieldReadOnly(rightsDateWrap, checked);
    if (rightsAnchorInput) rightsAnchorInput.readOnly = Boolean(checked);
    if (checked) {
      applyRightsDateFromDividend();
      applyRightsAnchorFromDividend();
    }
  }

  syncRightsWithDividendCb?.addEventListener("change", () => {
    setRightsSyncedUi(syncRightsWithDividendCb.checked);
  });
  dividendHidden?.addEventListener("input", applyRightsDateFromDividend);
  dividendHidden?.addEventListener("change", applyRightsDateFromDividend);
  dividendAnchorInput?.addEventListener("input", applyRightsAnchorFromDividend);
  dividendAnchorInput?.addEventListener("change", applyRightsAnchorFromDividend);

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
    const rightsAnchorRaw = String(fd.get("rightsAnchorClose") || "").trim();
    const rightsAnchorClose = rightsAnchorRaw !== "" ? Number(rightsAnchorRaw) : null;
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
    const splitExDates = Boolean(
      hasCash && hasStock && dividendDate && rightsDate && dividendDate !== rightsDate
    );
    let anchorForRights = anchorClose;
    if (splitExDates) {
      if (!Number.isFinite(rightsAnchorClose) || rightsAnchorClose <= 0) {
        alert("除權息為不同日期時，請填有效的除權前股價。");
        return;
      }
      anchorForRights = rightsAnchorClose;
    } else if (hasStock && !hasCash && Number.isFinite(rightsAnchorClose) && rightsAnchorClose > 0) {
      anchorForRights = rightsAnchorClose;
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
          anchorClose: anchorForRights,
          referenceAnchorDate: null,
          referencePrice: calcReferencePrice(anchorForRights, null, stockDividend, type),
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
      canManageHistory = true;
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

function bindHistoryActions() {
  if (!historyRoot) return;
  historyRoot.addEventListener("click", async (event) => {
    const editBtn = event.target.closest("[data-edit-history]");
    if (editBtn) {
      const date = editBtn.getAttribute("data-date");
      const type = editBtn.getAttribute("data-type");
      const target = findHistoryEvent(date, type);
      if (!target || !editHistoryDialog || !editHistoryForm) return;
      if (editHistorySymbol) {
        editHistorySymbol.textContent = `${stock.symbol} ${stock.name || ""}`.trim();
      }
      editHistoryForm.elements.originalDate.value = date || "";
      editHistoryForm.elements.originalType.value = type || "";
      const eventDateWrap = editHistoryForm.querySelector('.date-segment-field[data-date-name="eventDate"]');
      setDateFieldValue(eventDateWrap, normalizeYmdToDateInput(target.date));
      editHistoryForm.elements.anchorClose.value = target.anchorClose ?? "";
      editHistoryForm.elements.cashDividend.value = target.cashDividend ?? "";
      editHistoryForm.elements.stockDividend.value = target.stockDividend ?? "";
      editHistoryDialog.showModal();
      return;
    }

    const deleteBtn = event.target.closest("[data-delete-history]");
    if (!deleteBtn) return;
    const date = deleteBtn.getAttribute("data-date");
    const type = deleteBtn.getAttribute("data-type");
    if (!date || !type) return;
    if (!window.confirm(`確定刪除 ${date} 的除權息紀錄嗎？`)) return;
    try {
      await deleteManualCorporateEvent(stock.symbol, date, type);
      removeHistoryEvent(date, type);
      renderHistory(stock);
    } catch (error) {
      console.error(error);
      alert("刪除失敗，請確認你有 Firestore 寫入權限。");
    }
  });
}

function bindEditHistoryForm() {
  if (!editHistoryDialog || !editHistoryForm) return;
  cancelEditHistoryBtn?.addEventListener("click", () => {
    editHistoryDialog.close();
  });
  editHistoryDialog.addEventListener("click", (event) => {
    if (event.target === editHistoryDialog) {
      editHistoryDialog.close();
    }
  });
  editHistoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(editHistoryForm);
    const originalDate = String(fd.get("originalDate") || "").trim();
    const originalType = String(fd.get("originalType") || "").trim();
    const eventDate = normalizeDateInputToYmd(fd.get("eventDate"));
    const anchorClose = Number(fd.get("anchorClose"));
    const cashRaw = String(fd.get("cashDividend") || "").trim();
    const stockRaw = String(fd.get("stockDividend") || "").trim();
    const cashDividend = cashRaw === "" ? null : Number(cashRaw);
    const stockDividend = stockRaw === "" ? null : Number(stockRaw);
    if (!eventDate) {
      alert("請填入有效日期。");
      return;
    }
    if (!Number.isFinite(anchorClose) || anchorClose <= 0) {
      alert("請填入有效的除息前股價。");
      return;
    }
    if (cashDividend == null && stockDividend == null) {
      alert("現金股利與股票股利至少要填一項。");
      return;
    }
    if ((cashDividend != null && !Number.isFinite(cashDividend)) || (stockDividend != null && !Number.isFinite(stockDividend))) {
      alert("請確認股利欄位是有效數字。");
      return;
    }
    const nextType = getTypeByDividend(cashDividend, stockDividend);
    const payload = {
      name: stock.name || stock.symbol,
      date: eventDate,
      type: nextType,
      typeRaw: "manual_form",
      cashDividend,
      stockDividend,
      anchorClose,
      referenceAnchorDate: null,
      referencePrice: calcReferencePrice(anchorClose, cashDividend, stockDividend, nextType),
      referencePriceMode: "manual_anchor_input",
      source: "manual_user_input"
    };
    try {
      if (submitEditHistoryBtn) submitEditHistoryBtn.disabled = true;
      if (originalDate && originalType && (originalDate !== payload.date || originalType !== payload.type)) {
        await deleteManualCorporateEvent(stock.symbol, originalDate, originalType);
        removeHistoryEvent(originalDate, originalType);
      }
      await saveManualCorporateEvent(stock.symbol, payload);
      upsertHistoryEvent({
        date: payload.date,
        type: payload.type,
        cashDividend: payload.cashDividend,
        stockDividend: payload.stockDividend,
        referencePrice: payload.referencePrice,
        referenceAnchorDate: payload.referenceAnchorDate,
        anchorClose: payload.anchorClose
      });
      canManageHistory = true;
      renderHistory(stock);
      editHistoryDialog.close();
    } catch (error) {
      console.error(error);
      alert("儲存失敗，請確認你有 Firestore 寫入權限。");
    } finally {
      if (submitEditHistoryBtn) submitEditHistoryBtn.disabled = false;
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
    const actionLine = canManageHistory
      ? `
        <p class="history-actions">
          <button type="button" class="manual-cancel-btn" data-edit-history="1" data-date="${h.date}" data-type="${h.type || "--"}">編輯</button>
          <button type="button" class="manual-submit-btn" data-delete-history="1" data-date="${h.date}" data-type="${h.type || "--"}">刪除</button>
        </p>
      `
      : "";
    return `
      <article class="history-card ${tone}">
        <span class="timeline-dot ${tone}"></span>
        <p><strong>${h.date}</strong></p>
        <p>現金股利: ${cashText} | 股票股利: ${stockText}</p>
        <p>${isFutureEvent ? "目前價格" : "當時價格"}: ${eventPriceText}</p>
        <p>${refLine}</p>
        ${signalLine}
        ${actionLine}
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
    canManageHistory = stock.history.length > 0;
    if (!stock.history.length) {
      stock.history = await fetchCorporateActionHistory(stock.symbol, 10);
      canManageHistory = false;
    }
    if (!stock.history.length) {
      stock.history = await fetchDividendAnnouncementHistory(stock.symbol);
      canManageHistory = false;
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
      appBarOnlyLogout: true,
      onUserChanged: (u) => {
        // 登出後直接回到登入頁，避免在未登入狀態停留
        if (!u && isAuthAvailable()) {
          const returnTo = window.location.pathname + window.location.search;
          window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
        }
      }
    });
    initDateSegmentFields(document);
    bindManualEventForm();
    bindEditHistoryForm();
    bindHistoryActions();
    await initialize();
  } finally {
    setPageLoading(false);
  }
}

boot();
