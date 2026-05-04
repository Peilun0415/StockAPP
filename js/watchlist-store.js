import { firebaseConfig } from "./firebase-config.js";

const LS_KEY_BASE = "stockapp_watchlist_v1";
const DEFAULT_ITEMS = [];

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
  const slim = (items || []).map((x) => ({ symbol: x.symbol, name: x.name || x.symbol }));
  localStorage.setItem(LS_KEY, JSON.stringify(slim));
}

function sortWatchlistItems(raw) {
  if (!raw?.length) {
    return [];
  }
  const hasAnyOrder = raw.some((x) => Number.isFinite(Number(x?.sortOrder)));
  if (!hasAnyOrder) {
    return [...raw].sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")));
  }
  return [...raw].sort((a, b) => {
    const ao = Number(a.sortOrder);
    const bo = Number(b.sortOrder);
    const av = Number.isFinite(ao) ? ao : 1e9;
    const bv = Number.isFinite(bo) ? bo : 1e9;
    if (av !== bv) return av - bv;
    return String(a.symbol || "").localeCompare(String(b.symbol || ""));
  });
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
  return sortWatchlistItems(snap.docs.map((d) => d.data()));
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
  const col = getUserCollection(api, db, uid);
  const snap = await api.getDocs(col);
  const ordered = sortWatchlistItems(snap.docs.map((d) => d.data()));
  if (ordered.some((i) => i.symbol === item.symbol)) {
    await api.setDoc(
      getUserDoc(api, db, uid, item.symbol),
      { symbol: item.symbol, name: item.name || item.symbol },
      { merge: true }
    );
    return loadWatchlist(uid);
  }
  const maxOrder = ordered.reduce(
    (m, x) => Math.max(m, Number.isFinite(Number(x.sortOrder)) ? Number(x.sortOrder) : -1),
    -1
  );
  const payload = { ...item, sortOrder: maxOrder + 1 };
  await api.setDoc(getUserDoc(api, db, uid, item.symbol), payload, { merge: true });
  return loadWatchlist(uid);
}

export async function reorderWatchlist(orderedItems, uid = null) {
  const rows = (orderedItems || []).map((x, i) => ({
    symbol: x.symbol,
    name: x.name || x.symbol,
    sortOrder: i
  }));
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    saveLocalWatchlist(rows, uid);
    return getLocalWatchlist(uid);
  }
  const { db, api } = fb;
  const batch = api.writeBatch(db);
  for (const row of rows) {
    batch.set(getUserDoc(api, db, uid, row.symbol), row, { merge: true });
  }
  await batch.commit();
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

