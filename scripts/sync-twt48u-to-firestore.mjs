/**
 * 定期同步 TWT48U 全表列出的除權息事件至 Firestore（全域 marketCorporateActions）。
 * 環境變數（擇一）：
 *   FIREBASE_SERVICE_ACCOUNT — JSON 字串（GitHub Actions 建議用 secrets）
 *   GOOGLE_APPLICATION_CREDENTIALS — service account 檔案路徑（本機）
 *
 * 用法：node scripts/sync-twt48u-to-firestore.mjs
 */
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  fetchTwseRowsByYear,
  parseCorporateRow,
  pickBestEvent,
  formatDateYmd
} from "./twt48u-parse.mjs";

const YEARS_BACK = Number(process.env.TWT48U_YEARS_BACK || "5");

function initAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const json = JSON.parse(raw);
    initializeApp({ credential: cert(json) });
    return;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
    return;
  }
  console.error("請設定 FIREBASE_SERVICE_ACCOUNT（JSON 字串）或 GOOGLE_APPLICATION_CREDENTIALS");
  process.exit(1);
}

function eventDocId(symbol, dateText, typeText) {
  const d = String(dateText || "").replaceAll("/", "");
  return `${symbol.replace(/\./g, "_")}_${d}_${typeText}`;
}

function parseExDateSlash(dateText) {
  const [y, m, d] = String(dateText || "").split("/").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatSlashDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function formatYmdCompactFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

const stockDayAllCache = new Map();

async function fetchStockDayAllCloseMap(ymdCompact) {
  if (stockDayAllCache.has(ymdCompact)) {
    return stockDayAllCache.get(ymdCompact);
  }
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date=${ymdCompact}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`STOCK_DAY_ALL failed ${ymdCompact}: HTTP ${res.status}`);
  }
  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const map = new Map();
  for (const row of rows) {
    const code = String(row?.[0] || "").trim();
    if (!code) continue;
    const sym = `${code}.TW`;
    const close = Number(String(row?.[7] ?? "").replaceAll(",", ""));
    if (Number.isFinite(close)) {
      map.set(sym, close);
    }
  }
  stockDayAllCache.set(ymdCompact, map);
  return map;
}

/**
 * 除權息日前一個「有收盤資料」的交易日收盤價（例：4/20 除權息 → 取 4/19 收盤，遇假日往前找）
 */
async function findAnchorCloseBeforeEx(symbol, exDate) {
  const ex = exDate instanceof Date ? exDate : parseExDateSlash(String(exDate));
  if (!ex) return null;
  const d = new Date(ex.getFullYear(), ex.getMonth(), ex.getDate());
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 15; i += 1) {
    const ymd = formatYmdCompactFromDate(d);
    try {
      const map = await fetchStockDayAllCloseMap(ymd);
      const close = map.get(symbol);
      if (typeof close === "number" && Number.isFinite(close)) {
        return {
          referenceAnchorDate: formatSlashDate(d),
          anchorClose: close,
          anchorYmd: ymd
        };
      }
    } catch (error) {
      console.warn(`讀取收盤 ${ymd} 失敗`, error);
    }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

/** 台灣日曆「今天」0 點（僅用於日期比較） */
function taiwanTodayStart() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
  const datePart = String(s).split(" ")[0] || "";
  const [y, m, d] = datePart.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return new Date(y, m - 1, d);
}

/**
 * 僅在「台灣日曆已到除權息日前一日（含）」後才寫入鎖定參考價，
 * 避免遠期除權息誤用當天收盤往回套。
 * 例：4/20 除權息 → 4/19（含）起可寫入以 4/19（或遇假日前一交易日）收盤計算之參考價。
 */
function canLockReferenceForEx(exDate) {
  const ex0 = new Date(exDate.getFullYear(), exDate.getMonth(), exDate.getDate());
  const dayBeforeEx = new Date(ex0);
  dayBeforeEx.setDate(dayBeforeEx.getDate() - 1);
  const todayTw = taiwanTodayStart();
  return todayTw.getTime() >= dayBeforeEx.getTime();
}

function calcReferencePrice(basePrice, cashDividend, stockDividend, typeLabel) {
  const base = Number(basePrice);
  if (!Number.isFinite(base)) return null;
  const cash = Number.isFinite(Number(cashDividend)) ? Number(cashDividend) : 0;
  const stock = Number.isFinite(Number(stockDividend)) ? Number(stockDividend) : 0;
  const factor = 1 + stock / 10;

  if (typeLabel === "權息") {
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return Number(((base - cash) / factor).toFixed(4));
  }
  if (typeLabel === "息") {
    return Number((base - cash).toFixed(4));
  }
  if (typeLabel === "權") {
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return Number((base / factor).toFixed(4));
  }
  return null;
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentYear = now.getFullYear();
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i);

  const summaryBySymbol = new Map();
  const events = [];

  for (const year of years) {
    const rows = await fetchTwseRowsByYear(year);
    console.log(`TWT48U ${year}: ${rows.length} rows`);
    for (const row of rows) {
      const ev = parseCorporateRow(row, year);
      if (!ev) continue;
      events.push(ev);
      const prev = summaryBySymbol.get(ev.symbol);
      const candidate = {
        date: ev.date,
        name: ev.name,
        nextDividendDate: ev.nextDividendDate,
        nextRightsDate: ev.nextRightsDate,
        cashDividend: ev.cashDividend,
        stockDividend: ev.stockDividend
      };
      summaryBySymbol.set(ev.symbol, pickBestEvent(prev, candidate, today));
    }
  }

  let batch = db.batch();
  let n = 0;
  const commitIfNeeded = async () => {
    if (n >= 450) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  };

  for (const ev of events) {
    const sym = ev.symbol;
    const typeLabel = ev.typeText.includes("權") && ev.typeText.includes("息")
      ? "權息"
      : ev.typeText.includes("息")
        ? "息"
        : "權";
    const exDt = parseExDateSlash(ev.dateText);
    const anchor = exDt && canLockReferenceForEx(exDt)
      ? await findAnchorCloseBeforeEx(sym, exDt)
      : null;
    const anchorClose = anchor?.anchorClose ?? null;
    const referenceAnchorDate = anchor?.referenceAnchorDate ?? null;
    const referencePrice = anchorClose == null
      ? null
      : calcReferencePrice(anchorClose, ev.cashDividend, ev.stockDividend, typeLabel);
    const payload = {
      symbol: sym,
      name: ev.name || sym,
      date: ev.dateText,
      type: typeLabel,
      typeRaw: ev.typeText,
      cashDividend: ev.cashDividend,
      stockDividend: ev.stockDividend,
      referenceAnchorDate,
      anchorClose,
      referencePrice,
      referencePriceMode: referencePrice == null ? null : "anchor_close_before_ex",
      source: "TWT48U",
      syncedAt: FieldValue.serverTimestamp()
    };
    const eid = eventDocId(sym, ev.dateText, typeLabel);
    const ref = db.collection("marketCorporateActions").doc(sym).collection("events").doc(eid);
    batch.set(ref, payload, { merge: true });
    n += 1;
    await commitIfNeeded();
  }

  if (n > 0) {
    await batch.commit();
  }

  batch = db.batch();
  n = 0;

  for (const [sym, best] of summaryBySymbol) {
    const name = best.name || sym;
    const typeLabel = (best.nextDividendDate && best.nextRightsDate) ? "權息" : (best.nextDividendDate ? "息" : "權");
    const anchor = best.date && canLockReferenceForEx(best.date)
      ? await findAnchorCloseBeforeEx(sym, best.date)
      : null;
    const anchorClose = anchor?.anchorClose ?? null;
    const referenceAnchorDate = anchor?.referenceAnchorDate ?? null;
    const referencePrice = anchorClose == null
      ? null
      : calcReferencePrice(anchorClose, best.cashDividend, best.stockDividend, typeLabel);
    const summaryRef = db.collection("marketCorporateActions").doc(sym);
    batch.set(
      summaryRef,
      {
        symbol: sym,
        name,
        latestDate: formatDateYmd(best.date),
        nextDividendDate: best.nextDividendDate ?? "還未公佈",
        nextRightsDate: best.nextRightsDate ?? "還未公佈",
        cashDividend: best.cashDividend ?? null,
        stockDividend: best.stockDividend ?? null,
        referenceAnchorDate,
        anchorClose,
        referencePrice,
        referencePriceMode: referencePrice == null ? null : "anchor_close_before_ex",
        source: "TWT48U",
        syncedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    n += 1;
    await commitIfNeeded();
  }

  if (n > 0) {
    await batch.commit();
  }

  console.log(`Done. Events: ${events.length}, symbols with summary: ${summaryBySymbol.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
