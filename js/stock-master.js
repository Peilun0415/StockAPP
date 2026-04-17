const TWSE_ENDPOINTS = [
  "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json"
];
const RETRY_MS_MIN = 3000;
const RETRY_MS_MAX = 60000;

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
  // 取 Code/Name/最近收盤價（ClosingPrice），避免 payload 太大
  const map = new Map();
  for (const row of rows || []) {
    const isArrayRow = Array.isArray(row);
    const code = isArrayRow
      ? row[0]
      : row.Code || row.code || row.Symbol || row.symbol;
    const name = isArrayRow
      ? row[1]
      : row.Name || row.name || row.NameZh || row.nameZh || "";
    const symbol = toSymbol(code);
    if (!symbol) continue;
    if (!map.has(symbol)) {
      const closing = isArrayRow
        ? row[7]
        : row.ClosingPrice ?? row.ClosePrice ?? row.closingPrice ?? row.closePrice ?? null;
      const lastClose = closing === null || closing === "" ? null : Number(closing);
      map.set(symbol, { symbol, name: String(name || "").trim(), lastClose: Number.isFinite(lastClose) ? lastClose : null });
    }
  }
  return Array.from(map.values()).filter((x) => x.symbol && x.name);
}

// Scheme A：不使用 localStorage 儲存股票主檔快取

async function fetchTwseMaster() {
  let lastError = null;
  for (const endpoint of TWSE_ENDPOINTS) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json();
      const rows = Array.isArray(payload) ? payload : payload?.data;
      return buildMasterFromTwseRows(rows);
    } catch (error) {
      lastError = new Error(`endpoint ${endpoint} failed: ${error?.message || error}`);
    }
  }
  throw lastError || new Error("all TWSE endpoints failed");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function loadStockMasterList() {
  // 不再 fallback 本地快照，改為持續重試遠端直到成功
  // 注意：若遠端長時間不可用，這裡會持續等待。
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
    await sleep(retryMs);
    retryMs = Math.min(RETRY_MS_MAX, retryMs * 2);
  }
}

export function searchStockMaster(masterList, query) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const matches = masterList.filter((s) => {
    const symbol = normalizeSymbol(s.symbol);
    const name = String(s.name || "");
    if (q.includes(".")) {
      return symbol === q || symbol.includes(q);
    }
    // 使用者輸入純代號：支援「2330」或「2330.TW」
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

