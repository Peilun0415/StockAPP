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
        stockDividend: x.stockDividend ?? null,
        referencePrice: x.referencePrice ?? null,
        referenceAnchorDate: x.referenceAnchorDate ?? null,
        anchorClose: x.anchorClose ?? null
      }))
      .filter((x) => x.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch (error) {
    console.warn("讀取市場除權息歷史失敗", error);
    return [];
  }
}

function formatTodayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/**
 * 讀取每檔股票「上一期（最近已發生）」除權息事件。
 */
export async function loadLatestCompletedEvents(symbols) {
  const list = (symbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean);
  if (!list.length) return new Map();
  const fb = await ensureFirestore();
  if (!fb) return new Map();
  const { db, api } = fb;
  const todayYmd = formatTodayYmd();
  const out = new Map();
  await Promise.all(list.map(async (symbol) => {
    try {
      const ref = api.collection(db, "marketCorporateActions", symbol, "events");
      const q = api.query(
        ref,
        api.where("date", "<=", todayYmd),
        api.orderBy("date", "desc"),
        api.limit(1)
      );
      const snap = await api.getDocs(q);
      if (snap.empty) return;
      const x = snap.docs[0].data();
      out.set(symbol, {
        date: x.date ?? null,
        type: x.type || x.typeRaw || "--",
        referencePrice: x.referencePrice ?? null,
        anchorClose: x.anchorClose ?? null,
        referenceAnchorDate: x.referenceAnchorDate ?? null
      });
    } catch (error) {
      console.warn("讀取上一期除權息事件失敗", symbol, error);
    }
  }));
  return out;
}

function eventDocId(symbol, dateText, typeText) {
  const d = String(dateText || "").replaceAll("/", "");
  return `${String(symbol || "").replace(/\./g, "_")}_${d}_${typeText}`;
}

/**
 * 寫入手動維護的除權息事件（marketCorporateActions/{symbol}/events/{eventId}）
 */
export async function saveManualCorporateEvent(symbol, eventPayload) {
  const s = String(symbol || "").toUpperCase();
  if (!s) {
    throw new Error("缺少股票代號");
  }
  if (!eventPayload?.date || !eventPayload?.type) {
    throw new Error("缺少必要欄位 date/type");
  }
  const fb = await ensureFirestore();
  if (!fb) {
    throw new Error("Firebase 尚未設定，無法寫入");
  }
  const { db, api } = fb;
  const eventId = eventDocId(s, eventPayload.date, eventPayload.type);
  const ref = api.doc(db, "marketCorporateActions", s, "events", eventId);
  await api.setDoc(ref, {
    ...eventPayload,
    symbol: s,
    syncedAt: api.serverTimestamp()
  }, { merge: true });
  return eventId;
}

/**
 * 刪除手動維護的除權息事件（marketCorporateActions/{symbol}/events/{eventId}）
 */
export async function deleteManualCorporateEvent(symbol, dateText, typeText) {
  const s = String(symbol || "").toUpperCase();
  if (!s) {
    throw new Error("缺少股票代號");
  }
  if (!dateText || !typeText) {
    throw new Error("缺少必要欄位 date/type");
  }
  const fb = await ensureFirestore();
  if (!fb) {
    throw new Error("Firebase 尚未設定，無法刪除");
  }
  const { db, api } = fb;
  const eventId = eventDocId(s, dateText, typeText);
  const ref = api.doc(db, "marketCorporateActions", s, "events", eventId);
  await api.deleteDoc(ref);
  return eventId;
}
