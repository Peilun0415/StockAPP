import { firebaseConfig } from "./firebase-config.js";

export const ADMIN_ERROR_VIEWER_UID = "iRrXdzEUYZOHx5pMPxiqAerULIU2";

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
    console.warn("Firebase 初始化失敗，無法寫入錯誤紀錄", error);
    return null;
  }
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack || null };
  }
  return { message: String(error ?? "unknown error"), stack: null };
}

export async function reportAppError(source, error, extra = {}) {
  const fb = await ensureFirestore();
  if (!fb) return;
  const { db, api } = fb;
  const normalized = normalizeError(error);
  try {
    await api.addDoc(api.collection(db, "appErrors"), {
      source: String(source || "unknown"),
      message: String(normalized.message).slice(0, 500),
      stack: normalized.stack ? String(normalized.stack).slice(0, 2000) : null,
      url: typeof window !== "undefined" ? window.location.href : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      uid: extra.uid ? String(extra.uid) : null,
      detail: extra.detail ? String(extra.detail).slice(0, 1000) : null,
      createdAt: api.serverTimestamp()
    });
  } catch (reportError) {
    console.warn("寫入錯誤紀錄失敗", reportError);
  }
}

export async function loadRecentAppErrors(limit = 40) {
  const fb = await ensureFirestore();
  if (!fb) return [];
  const { db, api } = fb;
  try {
    const ref = api.collection(db, "appErrors");
    const q = api.query(ref, api.orderBy("createdAt", "desc"), api.limit(limit));
    const snap = await api.getDocs(q);
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn("讀取錯誤紀錄失敗", error);
    return [];
  }
}

export function installGlobalErrorReporting(getUid = () => null) {
  if (typeof window === "undefined" || window.__APP_ERROR_REPORTING__) return;
  window.__APP_ERROR_REPORTING__ = true;

  window.addEventListener("error", (event) => {
    reportAppError("window.error", event.error || event.message, {
      uid: getUid(),
      detail: `${event.filename || ""}:${event.lineno || ""}`
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportAppError("unhandledrejection", event.reason, { uid: getUid() });
  });
}
