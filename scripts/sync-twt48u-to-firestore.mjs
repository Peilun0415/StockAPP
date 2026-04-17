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
    const payload = {
      symbol: sym,
      name: ev.name || sym,
      date: ev.dateText,
      type: typeLabel,
      typeRaw: ev.typeText,
      cashDividend: ev.cashDividend,
      stockDividend: ev.stockDividend,
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
