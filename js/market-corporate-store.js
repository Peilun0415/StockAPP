import { firebaseConfig } from "./firebase-config.js";

let firestoreDb = null;
let firestoreApi = null;

async function ensureFirestore() {
  if (!firebaseConfig) {
    return null;
  }
  if (firestoreDb) {
    return { db: firestoreDb, api: firestoreApi };
  }
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js");
    const mod = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js");
    const app = initializeApp(firebaseConfig);
    firestoreDb = mod.getFirestore(app);
    firestoreApi = mod;
    return { db: firestoreDb, api: firestoreApi };
  } catch (error) {
    console.warn("Firebase 初始化失敗，無法讀取市場除權息", error);
    return null;
  }
}

/**
 * 讀取定期同步寫入的全域除權息摘要（marketCorporateActions/{symbol}）
 */
export async function loadMarketCorporateSummaries(symbols) {
  const list = (symbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean);
  if (!list.length) return new Map();
  const fb = await ensureFirestore();
  if (!fb) return new Map();
  const { db, api } = fb;
  const out = new Map();
  await Promise.all(list.map(async (symbol) => {
    try {
      const ref = api.doc(db, "marketCorporateActions", symbol);
      const snap = await api.getDoc(ref);
      if (snap.exists()) {
        out.set(symbol, snap.data());
      }
    } catch (error) {
      console.warn("讀取市場除權息摘要失敗", symbol, error);
    }
  }));
  return out;
}

/**
 * 讀取歷年除權息事件（marketCorporateActions/{symbol}/events）
 */
export async function loadMarketCorporateHistory(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (!s) return [];
  const fb = await ensureFirestore();
  if (!fb) return [];
  const { db, api } = fb;
  try {
    const ref = api.collection(db, "marketCorporateActions", s, "events");
    const snap = await api.getDocs(ref);
    if (snap.empty) return [];
    return snap.docs
      .map((d) => d.data())
      .map((x) => ({
        date: x.date,
        type: x.type || x.typeRaw || "--",
        cashDividend: x.cashDividend ?? null,
        stockDividend: x.stockDividend ?? null
      }))
      .filter((x) => x.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch (error) {
    console.warn("讀取市場除權息歷史失敗", error);
    return [];
  }
}
