function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase();
}

function toMisExCh(symbol) {
  const s = normalizeSymbol(symbol);
  const code = s.replace(".TW", "");
  if (!/^\d{4,6}$/.test(code)) return null;
  return `tse_${code}.tw`;
}

function toNumber(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw === "-" || raw === "--") return null;
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

let cachedPriceMap = null;
let cachedPriceMapAt = 0;
const CACHE_MS = 5 * 60 * 1000; // 5 minutes
const TWSE_DAY_ALL_ENDPOINTS = [
  "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json"
];
// MIS 在瀏覽器端常被 CORS 擋下，預設停用以避免 console 噪音與錯誤。
const ENABLE_MIS_REALTIME = false;

async function fetchMisRealtimePrices(symbols) {
  const exList = symbols.map(toMisExCh).filter(Boolean);
  if (!exList.length) return new Map();
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=${encodeURIComponent(exList.join("|"))}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MIS fetch failed: HTTP ${res.status}`);
  }
  const payload = await res.json();
  const msgArray = Array.isArray(payload?.msgArray) ? payload.msgArray : [];
  const map = new Map();
  for (const row of msgArray) {
    const code = String(row?.c || "").trim();
    if (!code) continue;
    // z: 當盤最新成交價，若無成交時可用 y 昨收
    const latest = toNumber(row?.z);
    const prevClose = toNumber(row?.y);
    const symbol = `${code}.TW`;
    if (typeof latest === "number") {
      map.set(symbol, { price: latest, source: "realtime" });
      continue;
    }
    if (typeof prevClose === "number") {
      map.set(symbol, { price: prevClose, source: "prevClose" });
    }
  }
  return map;
}

async function fetchClosePrices(symbols) {
  const wanted = new Set((symbols || []).map((s) => normalizeSymbol(s)));
  if (!wanted.size) return new Map();
  let rows = null;
  let lastError = null;
  for (const endpoint of TWSE_DAY_ALL_ENDPOINTS) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json();
      rows = Array.isArray(payload) ? payload : payload?.data;
      if (Array.isArray(rows)) break;
      throw new Error("payload is not array");
    } catch (error) {
      lastError = new Error(`endpoint ${endpoint} failed: ${error?.message || error}`);
    }
  }
  if (!Array.isArray(rows)) {
    throw lastError || new Error("all day-all endpoints failed");
  }
  const out = new Map();
  for (const row of rows || []) {
    const isArrayRow = Array.isArray(row);
    const code = String(isArrayRow ? row[0] : row?.Code || row?.code || row?.Symbol || row?.symbol || "").trim();
    if (!code) continue;
    const symbol = `${code}.TW`;
    if (!wanted.has(symbol)) continue;
    const close = isArrayRow
      ? toNumber(row[7])
      : toNumber(row?.ClosingPrice ?? row?.ClosePrice ?? row?.closingPrice ?? row?.closePrice);
    out.set(symbol, close);
  }
  return out;
}

async function getFallbackPriceMap(symbols) {
  const wanted = new Set((symbols || []).map((s) => normalizeSymbol(s)));
  const hasAllWanted = (() => {
    if (!cachedPriceMap) return false;
    for (const symbol of wanted) {
      if (!cachedPriceMap.has(symbol)) return false;
    }
    return true;
  })();

  if (cachedPriceMap && Date.now() - cachedPriceMapAt < CACHE_MS && hasAllWanted) {
    return cachedPriceMap;
  }
  try {
    cachedPriceMap = await fetchClosePrices(symbols);
    cachedPriceMapAt = Date.now();
    return cachedPriceMap;
  } catch (error) {
    console.warn("取得收盤價失敗（使用空價格表）", error);
    cachedPriceMap = new Map();
    cachedPriceMapAt = Date.now();
    return cachedPriceMap;
  }
}

// 本專案在純前端環境下避免 Yahoo CORS 問題
// 這裡改用 TWSE OpenAPI 的最新收盤價（近似即時）
export async function fetchRealtimePrice(symbol) {
  const target = normalizeSymbol(symbol);
  let realtimeValue = null;
  if (ENABLE_MIS_REALTIME) {
    try {
      const realtimeMap = await fetchMisRealtimePrices([target]);
      realtimeValue = realtimeMap.get(target)?.price ?? null;
    } catch (error) {
      console.warn("MIS 即時報價取得失敗（單筆）", error);
    }
  }
  if (typeof realtimeValue === "number") {
    return realtimeValue;
  }
  const map = await getFallbackPriceMap([target]);
  const price = map.get(target);
  return typeof price === "number" ? price : null;
}

export async function fetchRealtimePrices(symbols) {
  const normalized = (symbols || []).map(normalizeSymbol);
  let realtimeMap = new Map();
  if (ENABLE_MIS_REALTIME) {
    try {
      // 只查當前需要的股票，避免 URL 過長
      realtimeMap = await fetchMisRealtimePrices(normalized);
    } catch (error) {
      console.warn("MIS 即時報價取得失敗（批次）", error);
    }
  }
  const map = await getFallbackPriceMap(normalized);
  return normalized.map((symbol) => {
    const realtime = realtimeMap.get(symbol);
    if (typeof realtime?.price === "number") {
      return { symbol, price: realtime.price, source: realtime.source };
    }
    const price = map.get(symbol);
    return { symbol, price: typeof price === "number" ? price : null, source: "close" };
  });
}

