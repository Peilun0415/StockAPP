export const SECTORS = [
  "半導體業", "玻璃陶瓷", "食品工業", "光電業", "其他電子業", "化學工業", "建材營造",
  "金融保險業", "居家生活", "鋼鐵工業", "生技醫療業", "數位雲端", "塑膠工業", "水泥工業",
  "紡織纖維", "航運業", "觀光餐旅", "貿易百貨", "運動休閒", "油電燃氣業", "造紙工業",
  "資訊服務業", "電機機械", "電器電纜", "電腦及週邊設備業", "電子零組件業", "電子通路業",
  "通信網路業", "汽車工業", "橡膠工業", "綠能環保", "金融業", "文化創意業", "農業科技", "其他"
];

export const MARK_CYCLE = ["✔️", "⭐", "❌", ""];

export const SCREENER_CONDITIONS_KEY = "stockapp_screener_conditions";

export function formatDataMonth(raw) {
  const text = String(raw || "").trim();
  if (text.length >= 5) {
    return `${text.slice(0, 3)}年${text.slice(3)}月`;
  }
  return text || "—";
}

export function formatGeneratedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", { hour12: false });
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function filterRows(rows, conditions) {
  const { monthPercent, yearPercent, epsPercent, selectedSectors } = conditions;
  return rows.filter((row) => {
    const month = Number(row.monthGrowth);
    const year = Number(row.yearGrowth);
    const eps = Number(row.epsGrowth);
    if (!Number.isFinite(month) || month < monthPercent) return false;
    if (!Number.isFinite(year) || year < yearPercent) return false;
    if (!Number.isFinite(eps) || eps < epsPercent) return false;
    if (selectedSectors.length && !selectedSectors.includes(row.industry)) return false;
    return true;
  }).sort((a, b) => {
    const ai = a.industry ?? "";
    const bi = b.industry ?? "";
    return ai.localeCompare(bi, "zh-Hant");
  });
}

export function getHighlightClass(row) {
  const month = Number(row.monthGrowth);
  const year = Number(row.yearGrowth);
  if (month >= 90 && year >= 90) return "ninety-highlight";
  if (month >= 60 && year >= 60) return "sixty-highlight";
  if (month >= 30 && year >= 30) return "thirty-highlight";
  return "";
}

export function formatNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : (value ?? "");
}

export function getEpsHeaders(quarters) {
  const current = quarters?.current ?? {};
  const prev = quarters?.prev ?? [];
  return [
    `EPS ${current.year ?? ""}年 Q${current.season ?? ""}`,
    `EPS ${prev[0]?.year ?? ""}年 Q${prev[0]?.season ?? ""}`,
    `EPS ${prev[1]?.year ?? ""}年 Q${prev[1]?.season ?? ""}`,
    `EPS ${prev[2]?.year ?? ""}年 Q${prev[2]?.season ?? ""}`
  ];
}

export function openCompanySearch(name) {
  const q = encodeURIComponent(`${name} moneydj`);
  window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer");
}

export function buildConditionsUrl(conditions) {
  const params = new URLSearchParams();
  params.set("month", String(conditions.monthPercent));
  params.set("year", String(conditions.yearPercent));
  params.set("eps", String(conditions.epsPercent));
  if (conditions.selectedSectors.length < SECTORS.length) {
    params.set("sectors", conditions.selectedSectors.join("|"));
  }
  return `./screener-result.html?${params.toString()}`;
}

export function parseConditionsFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (!params.has("month") && !params.has("year") && !params.has("eps")) {
    return null;
  }
  const monthPercent = Number(params.get("month")) || 0;
  const yearPercent = Number(params.get("year")) || 0;
  const epsPercent = Number(params.get("eps")) || 0;
  const sectorsRaw = params.get("sectors");
  const selectedSectors = sectorsRaw
    ? sectorsRaw.split("|").filter(Boolean)
    : [...SECTORS];
  return { monthPercent, yearPercent, epsPercent, selectedSectors };
}

export function saveConditions(conditions) {
  sessionStorage.setItem(SCREENER_CONDITIONS_KEY, JSON.stringify(conditions));
}

export function loadSavedConditions() {
  try {
    const raw = sessionStorage.getItem(SCREENER_CONDITIONS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadScreenerData() {
  const res = await fetch("./data/screener.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
