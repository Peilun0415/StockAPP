function normalizeSymbol(symbol) {
  return symbol.toUpperCase();
}

export async function fetchRealtimePrice(symbol) {
  const s = normalizeSymbol(symbol);
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1d`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice ?? result?.meta?.previousClose;
    return Number.isFinite(price) ? price : null;
  } catch (error) {
    console.warn(`取得即時股價失敗: ${s}`, error);
    return null;
  }
}

export async function fetchRealtimePrices(symbols) {
  const tasks = symbols.map(async (symbol) => ({
    symbol,
    price: await fetchRealtimePrice(symbol)
  }));
  return Promise.all(tasks);
}

