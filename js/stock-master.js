const TWSE_ENDPOINT = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const LOCAL_SNAPSHOT = "./data/stock-master.json";

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
    const code = row.Code || row.code || row.Symbol || row.symbol;
    const name = row.Name || row.name || row.NameZh || row.nameZh || "";
    const symbol = toSymbol(code);
    if (!symbol) continue;
    if (!map.has(symbol)) {
      const closing =
        row.ClosingPrice ?? row.ClosePrice ?? row.closingPrice ?? row.closePrice ?? null;
      const lastClose = closing === null || closing === "" ? null : Number(closing);
      map.set(symbol, { symbol, name: String(name || "").trim(), lastClose: Number.isFinite(lastClose) ? lastClose : null });
    }
  }
  return Array.from(map.values()).filter((x) => x.symbol && x.name);
}

// Scheme A：不使用 localStorage 儲存股票主檔快取

async function fetchTwseMaster() {
  const res = await fetch(TWSE_ENDPOINT);
  if (!res.ok) {
    throw new Error(`TWSE master fetch failed: HTTP ${res.status}`);
  }
  const rows = await res.json();
  return buildMasterFromTwseRows(rows);
}

async function fetchLocalSnapshot() {
  const res = await fetch(LOCAL_SNAPSHOT);
  if (!res.ok) {
    throw new Error(`Local snapshot fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Local snapshot invalid format");
  }
  return data
    .map((x) => ({
      symbol: normalizeSymbol(x.symbol),
      name: String(x.name || "").trim(),
      lastClose: Number.isFinite(Number(x.lastClose)) ? Number(x.lastClose) : null
    }))
    .filter((x) => x.symbol && x.name);
}

export async function loadStockMasterList() {
  try {
    const items = await fetchLocalSnapshot();
    if (items?.length) return items;
  } catch (error) {
    console.warn("讀取本地主檔失敗，改用遠端主檔（可能較慢/受限）", error);
  }

  // fallback：遠端抓取（不寫入 localStorage）
  const latest = await fetchTwseMaster();
  return latest?.length ? latest : [];
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

