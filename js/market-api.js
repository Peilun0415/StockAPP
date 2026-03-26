import { loadStockMasterList } from "./stock-master.js";

function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase();
}

let cachedPriceMap = null;
let cachedPriceMapAt = 0;
const CACHE_MS = 5 * 60 * 1000; // 5 minutes

async function getPriceMap() {
  if (cachedPriceMap && Date.now() - cachedPriceMapAt < CACHE_MS) {
    return cachedPriceMap;
  }
  try {
    const master = await loadStockMasterList();
    cachedPriceMap = new Map(master.map((s) => [normalizeSymbol(s.symbol), s.lastClose ?? null]));
    cachedPriceMapAt = Date.now();
    return cachedPriceMap;
  } catch (error) {
    console.warn("取得股價資料失敗（使用空價格表）", error);
    cachedPriceMap = new Map();
    cachedPriceMapAt = Date.now();
    return cachedPriceMap;
  }
}

// 本專案在純前端環境下避免 Yahoo CORS 問題
// 這裡改用 TWSE OpenAPI 的最新收盤價（近似即時）
export async function fetchRealtimePrice(symbol) {
  const map = await getPriceMap();
  const price = map.get(normalizeSymbol(symbol));
  return typeof price === "number" ? price : null;
}

export async function fetchRealtimePrices(symbols) {
  const map = await getPriceMap();
  return symbols.map((symbol) => {
    const price = map.get(normalizeSymbol(symbol));
    return { symbol, price: typeof price === "number" ? price : null };
  });
}

