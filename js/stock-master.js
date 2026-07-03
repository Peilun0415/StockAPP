import {
  fetchStockDayAllRows,
  normalizeStockDayAllRow,
  toCloseNumber
} from "./twse-stock-day-all.js";

const TWSE_ENDPOINTS = [
  "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json"
];
const RETRY_MS_MIN = 3000;
const RETRY_MS_MAX = 60000;
const FETCH_TIMEOUT_MS = 15_000;

function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase();
}

function normalizeQuery(q) {
  return String(q || "").trim().toUpperCase();
}

function toSymbol(code) {
  const c = String(code || "").trim();
  if (!c) return "";
  // OpenAPI 的 Code 沒有 .TW
  return `${c}.TW`;
}

function buildMasterFromTwseRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const { code, name, closingPrice } = normalizeStockDayAllRow(row);
    const symbol = toSymbol(code);
    if (!symbol) continue;
    if (!map.has(symbol)) {
      const lastClose = toCloseNumber(closingPrice);
      map.set(symbol, {
        symbol,
        name: String(name || "").trim(),
        lastClose
      });
    }
  }
  return Array.from(map.values()).filter((x) => x.symbol && x.name);
}

// Scheme A：不使用 localStorage 儲存股票主檔快取

async function fetchTwseMaster() {
  let lastError = null;
  for (const endpoint of TWSE_ENDPOINTS) {
    try {
      const rows = await fetchStockDayAllRows(endpoint, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      return buildMasterFromTwseRows(rows);
    } catch (error) {
      lastError = new Error(`endpoint ${endpoint} failed: ${error?.message || error}`);
    }
  }
  throw lastError || new Error("all TWSE endpoints failed");
}

async function loadScreenerStockMaster() {
  const res = await fetch("./data/screener.json", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const payload = await res.json();
  const map = new Map();
  for (const market of ["sii", "otc"]) {
    for (const row of payload?.[market]?.rows || []) {
      const code = String(row?.code || "").trim();
      const name = String(row?.name || "").trim();
      if (!code) continue;
      const symbol = toSymbol(code);
      if (!symbol || map.has(symbol)) continue;
      map.set(symbol, { symbol, name: name || symbol, lastClose: null });
    }
  }
  return Array.from(map.values());
}

/**
 * 搜尋用主檔：TWSE 單次嘗試，失敗則退回 screener.json（含上櫃名稱）。
 */
export async function loadStockMasterForSearch() {
  try {
    const items = await fetchTwseMaster();
    if (items?.length) {
      return items;
    }
    console.warn("TWSE 主檔回傳空資料，改用 screener.json");
  } catch (error) {
    console.warn("TWSE 主檔載入失敗，改用 screener.json", error);
  }
  try {
    return await loadScreenerStockMaster();
  } catch (error) {
    console.warn("screener.json 主檔載入失敗", error);
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function loadStockMasterList(options = {}) {
  const { retryUntilSuccess = true } = options;
  let retryMs = RETRY_MS_MIN;
  for (;;) {
    try {
      const items = await fetchTwseMaster();
      if (items?.length) {
        return items;
      }
      console.warn("遠端主檔回傳空資料，稍後重試");
    } catch (error) {
      console.warn("讀取遠端主檔失敗，稍後重試", error);
    }
    if (!retryUntilSuccess) {
      return [];
    }
    await sleep(retryMs);
    retryMs = Math.min(RETRY_MS_MAX, retryMs * 2);
  }
}

export function searchStockMaster(masterList, query) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const matches = masterList.filter((s) => {
    const symbol = normalizeSymbol(s.symbol);
    const name = String(s.name || "").toUpperCase();
    if (q.includes(".")) {
      return symbol === q || symbol.includes(q);
    }
    // 使用者輸入純代號：支援「2330」或「2330.TW」；名稱比對不分大小寫
    return symbol.replace(".TW", "").includes(q) || symbol.includes(q) || name.includes(q);
  });

  // 依「代號命中」優先
  matches.sort((a, b) => {
    const aSym = a.symbol.replace(".TW", "");
    const bSym = b.symbol.replace(".TW", "");
    const aStarts = aSym.startsWith(q) ? 1 : 0;
    const bStarts = bSym.startsWith(q) ? 1 : 0;
    return bStarts - aStarts;
  });

  return matches.slice(0, 8);
}

