import { stockDataset } from "./data.js";
import { firebaseConfig } from "./firebase-config.js";

const LS_KEY = "stockapp_watchlist_v1";
const DEFAULT_ITEMS = stockDataset.map((s) => ({ symbol: s.symbol, name: s.name }));

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
    console.warn("Firebase 初始化失敗，改用 localStorage", error);
    return null;
  }
}

function getLocalWatchlist() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_ITEMS));
    return [...DEFAULT_ITEMS];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_ITEMS));
      return [...DEFAULT_ITEMS];
    }
    return parsed;
  } catch {
    localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_ITEMS));
    return [...DEFAULT_ITEMS];
  }
}

function saveLocalWatchlist(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

export async function loadWatchlist() {
  const fb = await ensureFirestore();
  if (!fb) {
    return getLocalWatchlist();
  }

  const { db, api } = fb;
  const ref = api.collection(db, "watchlist");
  const snap = await api.getDocs(ref);
  if (snap.empty) {
    for (const item of DEFAULT_ITEMS) {
      await api.setDoc(api.doc(db, "watchlist", item.symbol), item);
    }
    return [...DEFAULT_ITEMS];
  }
  return snap.docs.map((d) => d.data());
}

export async function addWatchStock(item) {
  const fb = await ensureFirestore();
  if (!fb) {
    const list = getLocalWatchlist();
    const exists = list.some((i) => i.symbol === item.symbol);
    if (!exists) {
      list.push(item);
      saveLocalWatchlist(list);
    }
    return list;
  }
  const { db, api } = fb;
  await api.setDoc(api.doc(db, "watchlist", item.symbol), item, { merge: true });
  return loadWatchlist();
}

export async function removeWatchStock(symbol) {
  const fb = await ensureFirestore();
  if (!fb) {
    const list = getLocalWatchlist().filter((item) => item.symbol !== symbol);
    saveLocalWatchlist(list);
    return list;
  }
  const { db, api } = fb;
  await api.deleteDoc(api.doc(db, "watchlist", symbol));
  return loadWatchlist();
}

