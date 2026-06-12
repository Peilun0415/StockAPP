import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadMarks, saveMark } from "./screener-marks-store.js";
import { fetchRealtimePrices } from "./market-api.js";

const SECTORS = [
  "半導體業", "玻璃陶瓷", "食品工業", "光電業", "其他電子業", "化學工業", "建材營造",
  "金融保險業", "居家生活", "鋼鐵工業", "生技醫療業", "數位雲端", "塑膠工業", "水泥工業",
  "紡織纖維", "航運業", "觀光餐旅", "貿易百貨", "運動休閒", "油電燃氣業", "造紙工業",
  "資訊服務業", "電機機械", "電器電纜", "電腦及週邊設備業", "電子零組件業", "電子通路業",
  "通信網路業", "汽車工業", "橡膠工業", "綠能環保", "金融業", "文化創意業", "農業科技", "其他"
];

const MARK_CYCLE = ["✔️", "⭐", "❌", ""];

const authBtn = document.querySelector("#authBtn");
const authAvatarEl = document.querySelector("#authAvatar");
const pageLoadingEl = document.querySelector("#pageLoading");
const searchPageEl = document.querySelector("#searchPage");
const resultPageEl = document.querySelector("#resultPage");
const screenerFormEl = document.querySelector("#screenerForm");
const screenerDataDateEl = document.querySelector("#screenerDataDate");
const sectorChipsEl = document.querySelector("#sectorChips");
const sectorAllBtnEl = document.querySelector("#sectorAllBtn");
const backToFormBtnEl = document.querySelector("#backToFormBtn");
const queryConditionEl = document.querySelector("#queryCondition");
const dataSubtitleEl = document.querySelector("#dataSubtitle");
const dataTitleEl = document.querySelector("#dataTitle");
const searchInputEl = document.querySelector("#searchInput");
const screenerEmptyEl = document.querySelector("#screenerEmpty");
const screenerLoadErrorEl = document.querySelector("#screenerLoadError");
const checkboxCheckEl = document.querySelector("#checkbox-check");
const checkboxStarEl = document.querySelector("#checkbox-star");
const checkboxCrossEl = document.querySelector("#checkbox-cross");
const checkboxNoneEl = document.querySelector("#checkbox-none");
const colorSortBtnEl = document.querySelector("#colorSortBtn");

let screenerData = null;
let currentUid = null;
let marks = {};
let filteredResults = { sii: [], otc: [] };
let activeMarket = "sii";
let screenerDataPromise = null;
const sortState = {
  sii: { index: null, asc: true, color: null },
  otc: { index: null, asc: true, color: null }
};

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function formatDataMonth(raw) {
  const text = String(raw || "").trim();
  if (text.length >= 5) {
    return `${text.slice(0, 3)}年${text.slice(3)}月`;
  }
  return text || "—";
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", { hour12: false });
}

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
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

function getEpsHeaders(quarters) {
  const current = quarters?.current ?? {};
  const prev = quarters?.prev ?? [];
  return [
    `EPS ${current.year ?? ""}年 Q${current.season ?? ""}`,
    `EPS ${prev[0]?.year ?? ""}年 Q${prev[0]?.season ?? ""}`,
    `EPS ${prev[1]?.year ?? ""}年 Q${prev[1]?.season ?? ""}`,
    `EPS ${prev[2]?.year ?? ""}年 Q${prev[2]?.season ?? ""}`
  ];
}

function buildTableHeaders(market) {
  const marketData = screenerData?.[market];
  const epsHeaders = getEpsHeaders(marketData?.quarters);
  const table = document.getElementById(`resultTable-${market}`);
  const tr = table.querySelector("thead tr");
  const marketLabel = market === "sii" ? "上市" : "上櫃";
  tr.innerHTML = `
    <th>${marketLabel}</th>
    <th>公司名稱</th>
    <th>類別</th>
    <th>股價</th>
    <th>月營收增加%</th>
    <th>年營收增加%</th>
    <th>營業毛利(百萬)</th>
    <th>EPS增加%</th>
    <th>${epsHeaders[0]}</th>
    <th>${epsHeaders[1]}</th>
    <th>${epsHeaders[2]}</th>
    <th>${epsHeaders[3]}</th>
    <th>營業利益(百萬)</th>
    <th>淨利歸屬母公司(百萬)</th>
    <th>備註</th>
  `.trim();

  tr.querySelectorAll("th").forEach((th, index) => {
    th.addEventListener("click", () => sortTable(market, index, th));
  });
}

function filterRows(rows, conditions) {
  const { monthPercent, yearPercent, epsPercent, selectedSectors } = conditions;
  return rows.filter((row) => {
    const month = Number(row.monthGrowth);
    const year = Number(row.yearGrowth);
    const eps = Number(row.epsGrowth);
    if (!Number.isFinite(month) || month < monthPercent) return false;
    if (!Number.isFinite(year) || year < yearPercent) return false;
    if (!Number.isFinite(eps) || eps < epsPercent) return false;
    if (selectedSectors.length && !selectedSectors.includes(row.industry)) return false;
    return true;
  }).sort((a, b) => {
    const ai = a.industry ?? "";
    const bi = b.industry ?? "";
    return ai.localeCompare(bi, "zh-Hant");
  });
}

function getHighlightClass(row) {
  const month = Number(row.monthGrowth);
  const year = Number(row.yearGrowth);
  if (month >= 90 && year >= 90) return "ninety-highlight";
  if (month >= 60 && year >= 60) return "sixty-highlight";
  if (month >= 30 && year >= 30) return "thirty-highlight";
  return "";
}

function formatNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : (value ?? "");
}

function openCompanySearch(name) {
  const q = encodeURIComponent(`${name} moneydj`);
  window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer");
}

function getColorRank(tr) {
  if (tr.classList.contains("ninety-highlight")) return 3;
  if (tr.classList.contains("sixty-highlight")) return 2;
  if (tr.classList.contains("thirty-highlight")) return 1;
  return 0;
}

function shouldShowMark(mark) {
  if (!mark) return checkboxNoneEl.checked;
  if (mark === "✔️") return checkboxCheckEl.checked;
  if (mark === "⭐") return checkboxStarEl.checked;
  if (mark === "❌") return checkboxCrossEl.checked;
  return true;
}

function applyMarkFilterToRow(tr) {
  const mark = tr.querySelector(".status-cell")?.textContent ?? "";
  const hiddenByMark = !shouldShowMark(mark);
  const hiddenBySearch = tr.classList.contains("un-searched");
  tr.hidden = hiddenByMark || hiddenBySearch;
}

function applyRowFilters(market) {
  const table = document.getElementById(`resultTable-${market}`);
  table.querySelectorAll("tbody tr").forEach(applyMarkFilterToRow);
  updateEmptyState();
}

function updateEmptyState() {
  const table = document.getElementById(`resultTable-${activeMarket}`);
  const visible = Array.from(table.querySelectorAll("tbody tr")).some((tr) => !tr.hidden);
  screenerEmptyEl.hidden = visible;
}

function createRow(row, market) {
  const tr = document.createElement("tr");
  const mark = marks[row.code] ?? "";
  tr.dataset.code = row.code;
  tr.className = getHighlightClass(row);

  tr.innerHTML = `
    <td class="status-cell screener-sticky-col">${mark}</td>
    <td class="screener-name-cell screener-sticky-col link-button">${row.name ?? row.code}</td>
    <td>${row.industry ?? ""}</td>
    <td class="price-cell" data-price="${row.price ?? ""}">${row.price ?? ""}</td>
    <td>${formatNum(row.monthGrowth)}</td>
    <td>${formatNum(row.yearGrowth)}</td>
    <td>${row.grossProfit ?? ""}</td>
    <td>${formatNum(row.epsGrowth)}</td>
    <td>${formatNum(row.epsCurrent)}</td>
    <td>${row.eps1 ?? ""}</td>
    <td>${row.eps2 ?? ""}</td>
    <td>${row.eps3 ?? ""}</td>
    <td>${row.operatingIncome ?? ""}</td>
    <td>${row.netIncome ?? ""}</td>
    <td>${row.note ?? ""}</td>
  `.trim();

  tr.querySelector(".screener-name-cell").addEventListener("click", () => {
    openCompanySearch(row.name ?? row.code);
  });

  const statusTd = tr.querySelector(".status-cell");
  statusTd.addEventListener("click", async () => {
    const current = statusTd.textContent;
    const next = MARK_CYCLE[(MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length];
    statusTd.textContent = next;
    if (next) marks[row.code] = next;
    else delete marks[row.code];
    await saveMark(row.code, next, currentUid);
    applyMarkFilterToRow(tr);
    updateEmptyState();
  });

  if (!shouldShowMark(mark)) tr.hidden = true;
  return tr;
}

function renderTable(market, rows) {
  const table = document.getElementById(`resultTable-${market}`);
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";
  sortState[market] = { index: null, asc: true, color: null };
  table.querySelectorAll("thead th").forEach((th) => th.classList.remove("asc", "desc"));

  for (const row of rows) {
    tbody.appendChild(createRow(row, market));
  }
  if (market === activeMarket) updateColorSortBtn();
}

function updateColorSortBtn() {
  if (!colorSortBtnEl) return;
  const state = sortState[activeMarket];
  colorSortBtnEl.classList.remove("asc", "desc");
  if (state.color === "desc") {
    colorSortBtnEl.classList.add("desc");
    colorSortBtnEl.textContent = "依顏色排序 ▼";
  } else if (state.color === "asc") {
    colorSortBtnEl.classList.add("asc");
    colorSortBtnEl.textContent = "依顏色排序 ▲";
  } else {
    colorSortBtnEl.textContent = "依顏色排序";
  }
}

function sortByColor() {
  const market = activeMarket;
  const state = sortState[market];
  const table = document.getElementById(`resultTable-${market}`);
  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));

  state.index = null;
  state.asc = true;
  table.querySelectorAll("thead th").forEach((th) => th.classList.remove("asc", "desc"));

  const nextDir = state.color === "desc" ? "asc" : "desc";
  state.color = nextDir;
  const sign = nextDir === "desc" ? 1 : -1;

  rows.sort((a, b) => {
    const diff = getColorRank(b) - getColorRank(a);
    if (diff !== 0) return sign * diff;
    const aName = a.querySelector(".screener-name-cell")?.textContent ?? "";
    const bName = b.querySelector(".screener-name-cell")?.textContent ?? "";
    return aName.localeCompare(bName, "zh-Hant");
  });

  rows.forEach((row) => tbody.appendChild(row));
  updateColorSortBtn();
}

function sortTable(market, index, header) {
  const table = document.getElementById(`resultTable-${market}`);
  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const state = sortState[market];
  const isAsc = state.index === index ? !state.asc : true;
  state.index = index;
  state.asc = isAsc;
  state.color = null;

  table.querySelectorAll("thead th").forEach((th) => th.classList.remove("asc", "desc"));
  header.classList.add(isAsc ? "asc" : "desc");
  if (market === activeMarket) updateColorSortBtn();

  rows.sort((a, b) => {
    const aText = a.children[index]?.textContent.trim() ?? "";
    const bText = b.children[index]?.textContent.trim() ?? "";
    const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return isAsc ? aNum - bNum : bNum - aNum;
    }
    return isAsc
      ? aText.localeCompare(bText, "zh-Hant")
      : bText.localeCompare(aText, "zh-Hant");
  });

  rows.forEach((row) => tbody.appendChild(row));
}

function searchTable(query) {
  const q = query.trim().toLowerCase();
  const table = document.getElementById(`resultTable-${activeMarket}`);
  table.querySelectorAll("tbody tr").forEach((tr) => {
    tr.classList.toggle("un-searched", Boolean(q) && !tr.innerText.toLowerCase().includes(q));
    applyMarkFilterToRow(tr);
  });
  updateEmptyState();
}

async function refreshListedPrices(rows) {
  const symbols = rows.map((r) => `${r.code}.TW`);
  if (!symbols.length) return;
  try {
    const prices = await fetchRealtimePrices(symbols);
    const priceMap = new Map(prices.map((p) => [p.symbol.replace(".TW", ""), p]));
    const table = document.getElementById("resultTable-sii");
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const code = tr.dataset.code;
      const info = priceMap.get(code);
      const cell = tr.querySelector(".price-cell");
      if (!cell || !info || typeof info.price !== "number") return;
      cell.textContent = info.price.toFixed(2);
      cell.title = info.source === "realtime" ? "即時價" : "收盤價";
    });
  } catch (error) {
    console.warn("更新上市即時股價失敗", error);
  }
}

function showQuerySummary(conditions, siiCount, otcCount) {
  const { monthPercent, yearPercent, epsPercent, selectedSectors } = conditions;
  queryConditionEl.innerHTML = `
    月營收 ≥ ${monthPercent}%　｜　年營收 ≥ ${yearPercent}%　｜　EPS 成長 ≥ ${epsPercent}%<br>
    類股：${selectedSectors.length ? selectedSectors.join("、") : "全部"}
  `.trim();
  dataSubtitleEl.textContent = `符合條件：上市 ${siiCount} 筆、上櫃 ${otcCount} 筆`;
  dataTitleEl.textContent = `資料年月：${formatDataMonth(screenerData.sii.dataMonth)}（上櫃 ${formatDataMonth(screenerData.otc.dataMonth)}）`;
}

function switchMarket(market) {
  activeMarket = market;
  document.querySelectorAll(".screener-market-pills .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.market === market);
  });
  document.getElementById("resultTable-sii").classList.toggle("active", market === "sii");
  document.getElementById("resultTable-otc").classList.toggle("active", market === "otc");
  searchInputEl.value = "";
  applyRowFilters(market);
  updateEmptyState();
  updateColorSortBtn();
}

async function handleSubmit(event) {
  event.preventDefault();

  const submitBtn = screenerFormEl.querySelector(".screener-submit-btn");
  if (submitBtn?.disabled) return;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "資料載入中...";
    }
    await ensureScreenerData();
    if (!screenerData) return;

    const formData = new FormData(screenerFormEl);
  const conditions = {
    monthPercent: Number(formData.get("monthPercent")) || 0,
    yearPercent: Number(formData.get("yearPercent")) || 0,
    epsPercent: Number(formData.get("epsPercent")) || 0,
    selectedSectors: getSelectedSectors()
  };

  filteredResults.sii = filterRows(screenerData.sii.rows, conditions);
  filteredResults.otc = filterRows(screenerData.otc.rows, conditions);

  renderTable("sii", filteredResults.sii);
  renderTable("otc", filteredResults.otc);
  showQuerySummary(conditions, filteredResults.sii.length, filteredResults.otc.length);

  searchPageEl.hidden = true;
  resultPageEl.hidden = false;
  switchMarket("sii");
  screenerEmptyEl.hidden = filteredResults.sii.length > 0;

  if (filteredResults.sii.length) {
    refreshListedPrices(filteredResults.sii);
  }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "查詢";
    }
  }
}

function bindMarkFilterCheckbox(el, key) {
  const saved = localStorage.getItem(key);
  if (saved !== null) el.checked = saved === "true";
  el.addEventListener("change", () => {
    localStorage.setItem(key, String(el.checked));
    applyRowFilters("sii");
    applyRowFilters("otc");
    updateEmptyState();
  });
}

async function loadScreenerData() {
  const res = await fetch("./data/screener.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function applyScreenerData(data) {
  screenerData = data;
  buildTableHeaders("sii");
  buildTableHeaders("otc");
  const updated = formatGeneratedAt(data.generatedAt);
  screenerDataDateEl.textContent = updated
    ? `資料更新：${updated}｜月營收 ${formatDataMonth(data.sii.dataMonth)}`
    : "";
}

function startScreenerDataLoad() {
  if (screenerData) return Promise.resolve(screenerData);
  if (screenerDataPromise) return screenerDataPromise;

  screenerDataDateEl.textContent = "篩選資料載入中...";
  screenerDataPromise = loadScreenerData()
    .then((data) => {
      applyScreenerData(data);
      return data;
    })
    .catch((error) => {
      screenerDataPromise = null;
      screenerDataDateEl.textContent = "篩選資料載入失敗";
      screenerLoadErrorEl.hidden = false;
      throw error;
    });
  return screenerDataPromise;
}

async function ensureScreenerData() {
  if (screenerData) return screenerData;
  return startScreenerDataLoad();
}

async function reloadMarks(uid) {
  marks = await loadMarks(uid);
  for (const market of ["sii", "otc"]) {
    const table = document.getElementById(`resultTable-${market}`);
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const code = tr.dataset.code;
      const mark = marks[code] ?? "";
      const cell = tr.querySelector(".status-cell");
      if (cell) cell.textContent = mark;
      applyMarkFilterToRow(tr);
    });
  }
  updateEmptyState();
}

function bindEvents() {
  screenerFormEl.addEventListener("submit", handleSubmit);
  backToFormBtnEl.addEventListener("click", () => {
    resultPageEl.hidden = true;
    searchPageEl.hidden = false;
  });

  sectorAllBtnEl.addEventListener("click", () => {
    const allChecked = getSelectedSectors().length === SECTORS.length;
    setAllSectors(!allChecked);
  });

  sectorChipsEl.addEventListener("change", () => {
    sectorAllBtnEl.textContent = getSelectedSectors().length === SECTORS.length ? "全不選" : "全選";
  });

  document.querySelectorAll(".screener-market-pills .pill").forEach((btn) => {
    btn.addEventListener("click", () => switchMarket(btn.dataset.market));
  });

  searchInputEl.addEventListener("input", debounce(() => searchTable(searchInputEl.value)));

  bindMarkFilterCheckbox(checkboxCheckEl, "checkbox-check-status");
  bindMarkFilterCheckbox(checkboxStarEl, "checkbox-star-status");
  bindMarkFilterCheckbox(checkboxCrossEl, "checkbox-cross-status");
  bindMarkFilterCheckbox(checkboxNoneEl, "checkbox-none-status");

  colorSortBtnEl?.addEventListener("click", sortByColor);
}

async function boot() {
  try {
    setPageLoading(true);
    buildSectorChips();
    bindEvents();

    // 登入驗證完成即可顯示表單；資料與標記改背景載入
    const user = await requireAuth();
    currentUid = user?.uid ?? null;

    initGoogleAuthUI({
      authBtn,
      authUserEl: null,
      avatarEl: authAvatarEl,
      appBarOnlyLogout: true,
      onUserChanged: async (u) => {
        if (!u && isAuthAvailable()) {
          const returnTo = window.location.pathname + window.location.search;
          window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
          return;
        }
        currentUid = u?.uid ?? null;
        await reloadMarks(currentUid);
      }
    });

    setPageLoading(false);

    startScreenerDataLoad().catch((error) => {
      console.error("篩選資料載入失敗", error);
    });
    reloadMarks(currentUid).catch((error) => {
      console.warn("標記載入失敗", error);
    });
  } catch (error) {
    console.error("個股篩選初始化失敗", error);
    screenerLoadErrorEl.hidden = false;
    searchPageEl.hidden = true;
    setPageLoading(false);
  }
}

boot();
