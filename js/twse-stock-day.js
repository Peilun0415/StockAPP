import { toCloseNumber } from "./twse-stock-day-all.js";

const STOCK_DAY_ENDPOINTS = [
  "https://www.twse.com.tw/exchangeReport/STOCK_DAY",
  "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
];
const FETCH_TIMEOUT_MS = 15_000;
const monthRowsCache = new Map();

function toStockCode(symbol) {
  return String(symbol || "").replace(".TW", "").trim();
}

function formatRocSlashFromDate(d) {
  const rocYear = d.getFullYear() - 1911;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${rocYear}/${m}/${day}`;
}

export function formatSlashDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function formatYmdCompactFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function normalizeRocSlash(text) {
  const m = String(text || "").trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return `${Number(m[1])}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;
}

async function fetchStockMonthRows(symbol, dateInMonth) {
  const code = toStockCode(symbol);
  if (!code) return [];
  const d = dateInMonth instanceof Date ? dateInMonth : new Date(dateInMonth);
  if (Number.isNaN(d.getTime())) return [];

  const monthKey = `${code}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (monthRowsCache.has(monthKey)) {
    return monthRowsCache.get(monthKey);
  }

  const ymd = formatYmdCompactFromDate(d);
  let lastError = null;
  for (const endpoint of STOCK_DAY_ENDPOINTS) {
    const url = `${endpoint}?response=json&date=${ymd}&stockNo=${code}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      monthRowsCache.set(monthKey, rows);
      return rows;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("all STOCK_DAY endpoints failed");
}

function findCloseInMonthRows(rows, targetDate) {
  const roc = formatRocSlashFromDate(targetDate);
  const normalizedTarget = normalizeRocSlash(roc);
  for (const row of rows || []) {
    const rowDate = normalizeRocSlash(row?.[0]);
    if (rowDate !== normalizedTarget) continue;
    const close = toCloseNumber(row?.[6]);
    if (typeof close === "number") {
      return close;
    }
  }
  return null;
}

/**
 * 取得指定日期當天（若無成交則往前找）的收盤價。
 * 例：除權息 6/11 → 先查 6/10 收盤，遇假日再往前。
 */
export async function findStockCloseOnOrBefore(symbol, targetDate) {
  const start = targetDate instanceof Date
    ? new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
    : new Date(targetDate);
  if (Number.isNaN(start.getTime())) return null;

  const d = new Date(start.getTime());
  for (let i = 0; i < 15; i += 1) {
    try {
      const rows = await fetchStockMonthRows(symbol, d);
      const close = findCloseInMonthRows(rows, d);
      if (typeof close === "number") {
        return {
          referenceAnchorDate: formatSlashDate(d),
          anchorClose: close
        };
      }
    } catch (error) {
      console.warn(`讀取 ${symbol} 收盤 ${formatSlashDate(d)} 失敗`, error);
    }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

/**
 * 除權息日前一個交易日的收盤價（例：6/11 除權息 → 取 6/10 收盤）。
 */
export async function findAnchorCloseBeforeEx(symbol, exDate) {
  const ex = exDate instanceof Date ? exDate : new Date(exDate);
  if (Number.isNaN(ex.getTime())) return null;
  const dayBeforeEx = new Date(ex.getFullYear(), ex.getMonth(), ex.getDate());
  dayBeforeEx.setDate(dayBeforeEx.getDate() - 1);
  return findStockCloseOnOrBefore(symbol, dayBeforeEx);
}
