const TWSE_EXRIGHT_ENDPOINT = "https://www.twse.com.tw/exchangeReport/TWT48U";

export function toSymbol(code) {
  const c = String(code || "").trim();
  return c ? `${c}.TW` : "";
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, "").trim();
}

export function toNumber(text) {
  const cleaned = stripHtml(text).replaceAll(",", "");
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

export function parseRocDate(text) {
  const m = String(text || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function pickBestEvent(current, candidate, today) {
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

export function parseCorporateRow(row, targetYear) {
  const date = parseRocDate(row?.[0]);
  if (!date || date.getFullYear() !== targetYear) return null;
  const symbol = toSymbol(row?.[1]);
  if (!symbol) return null;
  const name = String(row?.[2] || "").trim();
  const typeText = String(row?.[3] || "");
  const hasDividend = typeText.includes("息");
  const hasRights = typeText.includes("權");
  if (!hasDividend && !hasRights) return null;
  const stockDividend = toNumber(row?.[4]);
  const cashDividend = toNumber(row?.[7]);
  return {
    symbol,
    name,
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

export async function fetchTwseRowsByYear(year) {
  const date = `${year}0101`;
  const url = `${TWSE_EXRIGHT_ENDPOINT}?response=json&date=${date}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch TWT48U failed: HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}
