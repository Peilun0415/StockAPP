import {
  fetchStockDayAllRows,
  normalizeStockDayAllRow,
  toCloseNumber
} from "./twse-stock-day-all.js";

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
let cachedScreenerPriceMap = null;
let cachedScreenerPriceMapAt = 0;
const CACHE_MS = 5 * 60 * 1000; // 5 minutes
const SCREENER_PRICE_CACHE_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const TWSE_DAY_ALL_ENDPOINTS = [
  "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json"
];
// 方案 C：改由外部 proxy（Cloudflare/Vercel/Render 等）代理 MIS，避免瀏覽器 CORS。
// 可在 index.html 載入前設定：window.__MIS_PROXY_ENDPOINT__ = "https://your-proxy.example.com/twse-mis";
function readMisProxyEndpoint() {
  if (typeof window === "undefined") return "";
  const byWindow = String(window.__MIS_PROXY_ENDPOINT__ || "").trim();
  if (byWindow) return byWindow;
  try {
    return String(window.localStorage?.getItem("misProxyEndpoint") || "").trim();
  } catch (_) {
    return "";
  }
}
const MIS_PROXY_ENDPOINT = readMisProxyEndpoint();
const ENABLE_MIS_REALTIME = Boolean(MIS_PROXY_ENDPOINT);

function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = FETCH_TIMEOUT_MS, ...rest } = options;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

async function loadScreenerPriceMap() {
  if (cachedScreenerPriceMap && Date.now() - cachedScreenerPriceMapAt < SCREENER_PRICE_CACHE_MS) {
    return cachedScreenerPriceMap;
  }
  try {
    const res = await fetchWithTimeout("./data/screener.json");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await res.json();
    const map = new Map();
    for (const market of ["sii", "otc"]) {
      for (const row of payload?.[market]?.rows || []) {
        const code = String(row?.code || "").trim();
        if (!code) continue;
        const symbol = `${code}.TW`;
        const price = toNumber(row?.price);
        if (typeof price === "number") {
          map.set(symbol, price);
        }
      }
    }
    cachedScreenerPriceMap = map;
    cachedScreenerPriceMapAt = Date.now();
    return map;
  } catch (error) {
    console.warn("讀取 screener.json 靜態股價失敗", error);
    return cachedScreenerPriceMap || new Map();
  }
}

async function getStaticFallbackPrice(symbol) {
  const map = await loadScreenerPriceMap();
  const price = map.get(normalizeSymbol(symbol));
  return typeof price === "number" ? price : null;
}

async function fetchMisRealtimePrices(symbols) {
  if (!ENABLE_MIS_REALTIME) return new Map();
  const list = (symbols || []).map(normalizeSymbol).filter(Boolean);
  if (!list.length) return new Map();
  const url = `${MIS_PROXY_ENDPOINT}?symbols=${encodeURIComponent(list.join(","))}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`MIS proxy fetch failed: HTTP ${res.status}`);
  }
  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const map = new Map();
  for (const row of rows) {
    const symbol = normalizeSymbol(row?.symbol);
    if (!symbol) continue;
    const price = toNumber(row?.price);
    const source = row?.source === "realtime" ? "realtime" : "prevClose";
    if (typeof price === "number") {
      map.set(symbol, { price, source });
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
      rows = await fetchStockDayAllRows(endpoint, { timeoutMs: FETCH_TIMEOUT_MS });
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
    const { code, closingPrice } = normalizeStockDayAllRow(row);
    if (!code) continue;
    const symbol = `${code}.TW`;
    if (!wanted.has(symbol)) continue;
    const close = toCloseNumber(closingPrice);
    if (typeof close === "number") {
      out.set(symbol, close);
    }
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
  const closePrice = map.get(target);
  if (typeof closePrice === "number") {
    return closePrice;
  }
  return getStaticFallbackPrice(target);
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
  const preliminary = normalized.map((symbol) => {
    const realtime = realtimeMap.get(symbol);
    if (typeof realtime?.price === "number") {
      return { symbol, price: realtime.price, source: realtime.source };
    }
    const closePrice = map.get(symbol);
    if (typeof closePrice === "number") {
      return { symbol, price: closePrice, source: "close" };
    }
    return { symbol, price: null, source: "close" };
  });

  if (!preliminary.some((row) => row.price == null)) {
    return preliminary;
  }

  const staticMap = await loadScreenerPriceMap();
  return preliminary.map((row) => {
    if (typeof row.price === "number") {
      return row;
    }
    const staticPrice = staticMap.get(row.symbol);
    if (typeof staticPrice === "number") {
      return { symbol: row.symbol, price: staticPrice, source: "static" };
    }
    return row;
  });
}

