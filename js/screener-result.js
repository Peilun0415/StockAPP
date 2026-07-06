import { subscribeAuthUser, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import { loadMarks, saveMark } from "./screener-marks-store.js";
import { fetchRealtimePrices } from "./market-api.js";
import {
  MARK_CYCLE,
  SECTORS,
  formatDataMonth,
  debounce,
  filterRows,
  getHighlightClass,
  formatNum,
  getEpsHeaders,
  openCompanySearch,
  parseConditionsFromUrl,
  saveConditions,
  loadScreenerData
} from "./screener-common.js";
import { normalizeMark, renderMarkCell } from "./icons.js";

const pageLoadingEl = document.querySelector("#pageLoading");
const queryConditionEl = document.querySelector("#queryCondition");
const siiCountEl = document.querySelector("#siiCount");
const otcCountEl = document.querySelector("#otcCount");
const dataTitleEl = document.querySelector("#dataTitle");
const sectorsExpandEl = document.querySelector("#sectorsExpand");
const sectorsSummaryEl = sectorsExpandEl?.querySelector(".screener-sectors-summary");
const sectorsTagsEl = sectorsExpandEl?.querySelector(".screener-sectors-tags");
const searchInputEl = document.querySelector("#searchInput");
const screenerEmptyEl = document.querySelector("#screenerEmpty");
const screenerLoadErrorEl = document.querySelector("#screenerLoadError");
const checkboxCheckEl = document.querySelector("#checkbox-check");
const checkboxStarEl = document.querySelector("#checkbox-star");
const checkboxCrossEl = document.querySelector("#checkbox-cross");
const checkboxNoneEl = document.querySelector("#checkbox-none");
const colorSortBtnEl = document.querySelector("#colorSortBtn");

const conditions = parseConditionsFromUrl();

let screenerData = null;
let currentUid = null;
let marks = {};
let filteredResults = { sii: [], otc: [] };
let activeMarket = "sii";
const sortState = {
  sii: { index: null, asc: true, color: null },
  otc: { index: null, asc: true, color: null }
};

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function getColorRank(tr) {
  if (tr.classList.contains("ninety-highlight")) return 3;
  if (tr.classList.contains("sixty-highlight")) return 2;
  if (tr.classList.contains("thirty-highlight")) return 1;
  return 0;
}

function shouldShowMark(mark) {
  const key = normalizeMark(mark);
  if (!key) return checkboxNoneEl.checked;
  if (key === "check") return checkboxCheckEl.checked;
  if (key === "star") return checkboxStarEl.checked;
  if (key === "cross") return checkboxCrossEl.checked;
  return true;
}

function setStatusCell(cell, mark) {
  const key = normalizeMark(mark);
  cell.dataset.mark = key;
  cell.innerHTML = renderMarkCell(key);
}

function applyMarkFilterToRow(tr) {
  const mark = tr.querySelector(".status-cell")?.dataset.mark ?? "";
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

function createRow(row, market) {
  const tr = document.createElement("tr");
  const mark = marks[row.code] ?? "";
  tr.dataset.code = row.code;
  tr.className = getHighlightClass(row);

  tr.innerHTML = `
    <td class="status-cell screener-sticky-col"></td>
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
  setStatusCell(statusTd, mark);
  statusTd.addEventListener("click", async () => {
    const current = statusTd.dataset.mark || "";
    const next = MARK_CYCLE[(MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length];
    setStatusCell(statusTd, next);
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
  for (const market of ["sii", "otc"]) {
    const table = document.getElementById(`resultTable-${market}`);
    if (!table) continue;
    table.querySelectorAll("tbody tr").forEach((tr) => {
      tr.classList.toggle("un-searched", Boolean(q) && !tr.innerText.toLowerCase().includes(q));
      applyMarkFilterToRow(tr);
    });
  }
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
      cell.title = info.source === "realtime"
        ? "即時價"
        : info.source === "static"
          ? "靜態參考價（screener.json）"
          : "收盤價";
    });
  } catch (error) {
    console.warn("更新上市即時股價失敗", error);
  }
}

const MAX_INLINE_SECTOR_CHIPS = 3;

function sectorChip(name) {
  return `<span class="screener-chip screener-chip-sector">${name}</span>`;
}

function filterChip(label, value) {
  return `<span class="screener-chip screener-chip-filter">${label} ≥ ${value}%</span>`;
}

function showQuerySummary(siiCount, otcCount) {
  const { monthPercent, yearPercent, epsPercent, selectedSectors } = conditions;
  const isAllSectors = selectedSectors.length >= SECTORS.length;

  siiCountEl.textContent = String(siiCount);
  otcCountEl.textContent = String(otcCount);
  dataTitleEl.textContent = `${formatDataMonth(screenerData.sii.dataMonth)} · 上櫃 ${formatDataMonth(screenerData.otc.dataMonth)}`;

  const chips = [
    filterChip("月營收", monthPercent),
    filterChip("年營收", yearPercent),
    filterChip("EPS", epsPercent)
  ];

  if (isAllSectors) {
    chips.push('<span class="screener-chip screener-chip-muted">全部類股</span>');
    sectorsExpandEl.hidden = true;
    sectorsExpandEl.open = false;
  } else if (selectedSectors.length <= MAX_INLINE_SECTOR_CHIPS) {
    chips.push(...selectedSectors.map(sectorChip));
    sectorsExpandEl.hidden = true;
    sectorsExpandEl.open = false;
  } else {
    chips.push(...selectedSectors.slice(0, 2).map(sectorChip));
    chips.push(`<span class="screener-chip screener-chip-more">+${selectedSectors.length - 2}</span>`);
    sectorsExpandEl.hidden = false;
    sectorsExpandEl.open = false;
    sectorsSummaryEl.textContent = `查看全部類股（${selectedSectors.length} 個）`;
    sectorsTagsEl.innerHTML = selectedSectors.map(sectorChip).join("");
  }

  queryConditionEl.innerHTML = chips.join("");
}

function switchMarket(market) {
  activeMarket = market;
  document.querySelectorAll(".screener-market-pills .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.market === market);
  });
  document.getElementById("resultTable-sii").classList.toggle("active", market === "sii");
  document.getElementById("resultTable-otc").classList.toggle("active", market === "otc");
  applyRowFilters("sii");
  applyRowFilters("otc");
  updateEmptyState();
  updateColorSortBtn();
}

function runQuery() {
  filteredResults.sii = filterRows(screenerData.sii.rows, conditions);
  filteredResults.otc = filterRows(screenerData.otc.rows, conditions);

  renderTable("sii", filteredResults.sii);
  renderTable("otc", filteredResults.otc);
  showQuerySummary(filteredResults.sii.length, filteredResults.otc.length);
  switchMarket("sii");
  screenerEmptyEl.hidden = filteredResults.sii.length > 0;

  if (filteredResults.sii.length) {
    refreshListedPrices(filteredResults.sii);
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

async function reloadMarks(uid) {
  marks = await loadMarks(uid);
  for (const market of ["sii", "otc"]) {
    const table = document.getElementById(`resultTable-${market}`);
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const code = tr.dataset.code;
      const mark = marks[code] ?? "";
      const cell = tr.querySelector(".status-cell");
      if (cell) setStatusCell(cell, mark);
      applyMarkFilterToRow(tr);
    });
  }
  updateEmptyState();
}

function bindEvents() {
  document.querySelectorAll(".screener-market-pills .pill").forEach((btn) => {
    btn.addEventListener("click", () => switchMarket(btn.dataset.market));
  });

  searchInputEl?.addEventListener("input", debounce(() => searchTable(searchInputEl.value)));

  bindMarkFilterCheckbox(checkboxCheckEl, "checkbox-check-status");
  bindMarkFilterCheckbox(checkboxStarEl, "checkbox-star-status");
  bindMarkFilterCheckbox(checkboxCrossEl, "checkbox-cross-status");
  bindMarkFilterCheckbox(checkboxNoneEl, "checkbox-none-status");

  colorSortBtnEl?.addEventListener("click", sortByColor);
}

async function boot() {
  if (!conditions) {
    window.location.replace("./screener.html");
    return;
  }

  setPageLoading(true);
  try {
    saveConditions(conditions);
    bindEvents();

    const authPromise = requireAuth().catch((error) => {
      console.warn("篩選結果登入檢查失敗", error);
      return null;
    });

    subscribeAuthUser(async (u) => {
      if (!u && isAuthAvailable()) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
        return;
      }
      currentUid = u?.uid ?? null;
      if (screenerData) await reloadMarks(currentUid);
    });

    screenerData = await loadScreenerData();
    buildTableHeaders("sii");
    buildTableHeaders("otc");

    const user = await authPromise;
    currentUid = user?.uid ?? null;
    if (!user && isAuthAvailable()) return;

    runQuery();

    reloadMarks(currentUid).catch((error) => {
      console.warn("標記載入失敗", error);
    });
  } catch (error) {
    console.error("篩選結果初始化失敗", error);
    screenerLoadErrorEl.hidden = false;
  } finally {
    setPageLoading(false);
  }
}

boot();
