import { stockDataset } from "./data.js";
import { firebaseConfig } from "./firebase-config.js";

const LS_KEY_BASE = "stockapp_watchlist_v1";
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

function getLocalWatchlist(uid) {
  const LS_KEY = uid ? `${LS_KEY_BASE}_${uid}` : LS_KEY_BASE;
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

function saveLocalWatchlist(items, uid) {
  const LS_KEY = uid ? `${LS_KEY_BASE}_${uid}` : LS_KEY_BASE;
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

function getUserDoc(api, db, uid, symbol) {
  return api.doc(db, "users", uid, "watchlist", symbol);
}

function getUserCollection(api, db, uid) {
  return api.collection(db, "users", uid, "watchlist");
}

export async function loadWatchlist(uid = null) {
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    return getLocalWatchlist(uid);
  }

  const { db, api } = fb;
  const ref = getUserCollection(api, db, uid);
  const snap = await api.getDocs(ref);
  if (snap.empty) {
    for (const item of DEFAULT_ITEMS) {
      await api.setDoc(getUserDoc(api, db, uid, item.symbol), item);
    }
    return [...DEFAULT_ITEMS];
  }
  return snap.docs.map((d) => d.data());
}

export async function addWatchStock(item, uid = null) {
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    const list = getLocalWatchlist(uid);
    const exists = list.some((i) => i.symbol === item.symbol);
    if (!exists) {
      list.push(item);
      saveLocalWatchlist(list, uid);
    }
    return list;
  }
  const { db, api } = fb;
  await api.setDoc(getUserDoc(api, db, uid, item.symbol), item, { merge: true });
  return loadWatchlist(uid);
}

export async function removeWatchStock(symbol, uid = null) {
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    const list = getLocalWatchlist(uid).filter((item) => item.symbol !== symbol);
    saveLocalWatchlist(list, uid);
    return list;
  }
  const { db, api } = fb;
  await api.deleteDoc(getUserDoc(api, db, uid, symbol));
  return loadWatchlist(uid);
}

