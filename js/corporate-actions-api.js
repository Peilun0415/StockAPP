const TWSE_EXRIGHT_ENDPOINT = "https://www.twse.com.tw/exchangeReport/TWT48U";
const TWSE_DIVIDEND_ANNOUNCE_ENDPOINT = "https://openapi.twse.com.tw/v1/opendata/t187ap45_L";

function toSymbol(code) {
  const c = String(code || "").trim();
  return c ? `${c}.TW` : "";
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, "").trim();
}

function toNumber(text) {
  const cleaned = stripHtml(text).replaceAll(",", "");
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function parseRocDate(text) {
  // 例：115年04月20日 -> 2026/04/20
  const m = String(text || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseRocCompactDate(text) {
  // 例：1150210 -> 2026/02/10
  const m = String(text || "").match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function pickBestEvent(current, candidate, today) {
  if (!current) return candidate;
  const curFuture = current.date >= today;
  const candFuture = candidate.date >= today;

  if (curFuture && candFuture) {
    return candidate.date < current.date ? candidate : current;
  }
  if (!curFuture && !candFuture) {
    return candidate.date > current.date ? candidate : current;
  }
  return candFuture ? candidate : current;
}

function parseCorporateRow(row, targetYear) {
  const date = parseRocDate(row?.[0]);
  if (!date || date.getFullYear() !== targetYear) return null;
  const symbol = toSymbol(row?.[1]);
  if (!symbol) return null;

  const typeText = String(row?.[3] || "");
  const hasDividend = typeText.includes("息");
  const hasRights = typeText.includes("權");
  if (!hasDividend && !hasRights) return null;

  const stockDividend = toNumber(row?.[4]);
  const cashDividend = toNumber(row?.[7]);
  return {
    symbol,
    date,
    dateText: formatDateYmd(date),
    typeText,
    hasDividend,
    hasRights,
    nextDividendDate: hasDividend ? formatDateYmd(date) : null,
    nextRightsDate: hasRights ? formatDateYmd(date) : null,
    cashDividend: hasDividend ? cashDividend : null,
    stockDividend: hasRights ? stockDividend : null
  };
}

async function fetchTwseRowsByYear(year) {
  const date = `${year}0101`;
  const url = `${TWSE_EXRIGHT_ENDPOINT}?response=json&date=${date}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch corporate actions failed: HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

function buildCorporateMap(rows, targetYear) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bySymbol = new Map();

  for (const row of rows || []) {
    const event = parseCorporateRow(row, targetYear);
    if (!event) continue;

    const current = bySymbol.get(event.symbol);
    bySymbol.set(event.symbol, pickBestEvent(current, event, today));
  }

  return bySymbol;
}

export async function fetchAnnualCorporateActions(symbols, year = new Date().getFullYear()) {
  const uniqueSymbols = new Set((symbols || []).map((s) => String(s || "").toUpperCase()));
  if (!uniqueSymbols.size) return new Map();

  const rows = await fetchTwseRowsByYear(year);
  const allMap = buildCorporateMap(rows, year);
  const filtered = new Map();
  for (const symbol of uniqueSymbols) {
    const item = allMap.get(symbol);
    if (item) {
      filtered.set(symbol, item);
    }
  }
  return filtered;
}

export async function fetchCorporateActionHistory(symbol, years = 5) {
  const s = String(symbol || "").toUpperCase();
  if (!s) return [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearCount = Number.isFinite(Number(years)) ? Math.max(1, Number(years)) : 5;
  const yearsToFetch = Array.from({ length: yearCount }, (_, idx) => currentYear - idx);

  const results = await Promise.all(yearsToFetch.map(async (year) => {
    const rows = await fetchTwseRowsByYear(year);
    return rows
      .map((row) => parseCorporateRow(row, year))
      .filter((x) => x && x.symbol === s)
      .map((x) => ({
        date: x.dateText,
        type: x.typeText,
        cashDividend: x.cashDividend,
        stockDividend: x.stockDividend
      }));
  }));

  return results
    .flat()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function fetchDividendAnnouncementHistory(symbol) {
  const code = String(symbol || "").toUpperCase().replace(".TW", "");
  if (!code) return [];
  const res = await fetch(TWSE_DIVIDEND_ANNOUNCE_ENDPOINT);
  if (!res.ok) {
    throw new Error(`Fetch dividend announcement failed: HTTP ${res.status}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((r) => String(r?.["公司代號"] || "").trim() === code)
    .map((r) => {
      const dt = parseRocCompactDate(r?.["董事會（擬議）股利分派日"]);
      const cash = toNumber(r?.["股東配發-盈餘分配之現金股利(元/股)"]) ?? 0;
      const cashLaw = toNumber(r?.["股東配發-法定盈餘公積發放之現金(元/股)"]) ?? 0;
      const cashCapital = toNumber(r?.["股東配發-資本公積發放之現金(元/股)"]) ?? 0;
      const stock = (toNumber(r?.["股東配發-盈餘轉增資配股(元/股)"]) ?? 0)
        + (toNumber(r?.["股東配發-法定盈餘公積轉增資配股(元/股)"]) ?? 0)
        + (toNumber(r?.["股東配發-資本公積轉增資配股(元/股)"]) ?? 0);
      return {
        date: dt ? formatDateYmd(dt) : `${Number(r?.["股利年度"] || 0) + 1911}/01/01`,
        type: "股利公告",
        cashDividend: cash + cashLaw + cashCapital,
        stockDividend: stock || null
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
