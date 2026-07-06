// 個股篩選頁標記儲存：登入時存 Firestore（跨裝置同步），未登入退回 localStorage
import { firebaseConfig } from "./firebase-config.js";
import { MARK_KEYS, normalizeMark } from "./icons.js";

const LS_KEY_BASE = "stockapp_screener_marks_v1";
export { MARK_KEYS };

let firestoreDb = null;
let firestoreApi = null;

async function ensureFirestore() {
  if (!firebaseConfig) return null;
  if (firestoreDb) return { db: firestoreDb, api: firestoreApi };
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js");
    const mod = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js");
    const app = initializeApp(firebaseConfig);
    firestoreDb = mod.getFirestore(app);
    firestoreApi = mod;
    return { db: firestoreDb, api: firestoreApi };
  } catch (error) {
    console.warn("Firebase 初始化失敗，標記改用 localStorage", error);
    return null;
  }
}

function lsKey(uid) {
  return uid ? `${LS_KEY_BASE}_${uid}` : LS_KEY_BASE;
}

function normalizeMarksMap(raw) {
  const out = {};
  for (const [code, state] of Object.entries(raw || {})) {
    const key = normalizeMark(state);
    if (key) out[code] = key;
  }
  return out;
}

function getLocalMarks(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(lsKey(uid)) || "{}");
    return normalizeMarksMap(typeof parsed === "object" && parsed ? parsed : {});
  } catch {
    return {};
  }
}

function saveLocalMarks(marks, uid) {
  localStorage.setItem(lsKey(uid), JSON.stringify(marks));
}

function getMarkDoc(api, db, uid, code) {
  return api.doc(db, "users", uid, "screenerMarks", code);
}

// 回傳 { [公司代號]: "check" | "star" | "cross" }
export async function loadMarks(uid = null) {
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    return getLocalMarks(uid);
  }
  const { db, api } = fb;
  const snap = await api.getDocs(api.collection(db, "users", uid, "screenerMarks"));
  const marks = {};
  for (const doc of snap.docs) {
    const key = normalizeMark(doc.data()?.state);
    if (key) {
      marks[doc.id] = key;
    }
  }
  return marks;
}

// state 為空字串時表示清除標記
export async function saveMark(code, state, uid = null) {
  const key = normalizeMark(state);
  const fb = await ensureFirestore();
  if (!fb || !uid) {
    const marks = getLocalMarks(uid);
    if (key) marks[code] = key;
    else delete marks[code];
    saveLocalMarks(marks, uid);
    return;
  }
  const { db, api } = fb;
  if (key) {
    await api.setDoc(getMarkDoc(api, db, uid, code), { state: key, updatedAt: Date.now() });
  } else {
    await api.deleteDoc(getMarkDoc(api, db, uid, code));
  }
}
