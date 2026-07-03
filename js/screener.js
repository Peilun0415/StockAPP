import { subscribeAuthUser, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import {
  SECTORS,
  formatDataMonth,
  formatGeneratedAt,
  buildConditionsUrl,
  saveConditions,
  loadSavedConditions,
  loadScreenerData
} from "./screener-common.js";
import { installGlobalErrorReporting, reportAppError } from "./app-error-store.js";

const pageLoadingEl = document.querySelector("#pageLoading");
const screenerFormEl = document.querySelector("#screenerForm");
const screenerDataDateEl = document.querySelector("#screenerDataDate");
const sectorChipsEl = document.querySelector("#sectorChips");
const sectorAllBtnEl = document.querySelector("#sectorAllBtn");
const screenerLoadErrorEl = document.querySelector("#screenerLoadError");

let screenerDataPromise = null;

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function getSelectedSectors() {
  return Array.from(sectorChipsEl.querySelectorAll("input[type=checkbox]:checked"))
    .map((el) => el.value);
}

function buildSectorChips() {
  sectorChipsEl.innerHTML = SECTORS.map((sector) => `
    <label class="screener-sector-chip">
      <input type="checkbox" name="sector" value="${sector}" checked>
      <span>${sector}</span>
    </label>
  `).join("");
}

function setAllSectors(checked) {
  sectorChipsEl.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.checked = checked;
  });
  sectorAllBtnEl.textContent = checked ? "全不選" : "全選";
}

function getConditionsFromForm() {
  const formData = new FormData(screenerFormEl);
  return {
    monthPercent: Number(formData.get("monthPercent")) || 0,
    yearPercent: Number(formData.get("yearPercent")) || 0,
    epsPercent: Number(formData.get("epsPercent")) || 0,
    selectedSectors: getSelectedSectors()
  };
}

function restoreForm(conditions) {
  if (!conditions) return;
  screenerFormEl.elements.monthPercent.value = conditions.monthPercent || "";
  screenerFormEl.elements.yearPercent.value = conditions.yearPercent || "";
  screenerFormEl.elements.epsPercent.value = conditions.epsPercent || "";
  setAllSectors(false);
  const selected = new Set(conditions.selectedSectors ?? []);
  sectorChipsEl.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.checked = selected.has(el.value);
  });
  sectorAllBtnEl.textContent = getSelectedSectors().length === SECTORS.length ? "全不選" : "全選";
}

function handleSubmit(event) {
  event.preventDefault();
  const conditions = getConditionsFromForm();
  saveConditions(conditions);
  window.location.href = buildConditionsUrl(conditions);
}

function bindEvents() {
  screenerFormEl.addEventListener("submit", handleSubmit);

  sectorAllBtnEl.addEventListener("click", () => {
    const allChecked = getSelectedSectors().length === SECTORS.length;
    setAllSectors(!allChecked);
  });

  sectorChipsEl.addEventListener("change", () => {
    sectorAllBtnEl.textContent = getSelectedSectors().length === SECTORS.length ? "全不選" : "全選";
  });
}

function startScreenerDataLoad() {
  if (screenerDataPromise) return screenerDataPromise;

  screenerDataDateEl.textContent = "篩選資料載入中...";
  screenerDataPromise = loadScreenerData()
    .then((data) => {
      const updated = formatGeneratedAt(data.generatedAt);
      screenerDataDateEl.textContent = updated
        ? `資料更新：${updated}｜月營收 ${formatDataMonth(data.sii.dataMonth)}`
        : "";
      return data;
    })
    .catch((error) => {
      screenerDataPromise = null;
      screenerDataDateEl.textContent = "篩選資料載入失敗";
      screenerLoadErrorEl.hidden = false;
      reportAppError("screener.loadScreenerData", error);
      throw error;
    });
  return screenerDataPromise;
}

async function initScreenerAuth() {
  try {
    const user = await requireAuth();
    if (!user && isAuthAvailable()) return;
  } catch (error) {
    console.warn("個股篩選登入檢查失敗", error);
  }

  subscribeAuthUser((u) => {
    if (!u && isAuthAvailable()) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
    }
  });
}

async function boot() {
  setPageLoading(true);
  installGlobalErrorReporting();
  try {
    buildSectorChips();
    restoreForm(loadSavedConditions());
    bindEvents();
  } catch (error) {
    console.error("個股篩選初始化失敗", error);
    reportAppError("screener.boot", error);
    screenerLoadErrorEl.hidden = false;
  } finally {
    setPageLoading(false);
  }

  startScreenerDataLoad().catch((error) => {
    console.error("篩選資料載入失敗", error);
    reportAppError("screener.startScreenerDataLoad", error);
  });

  void initScreenerAuth();
}

boot();
