import { firebaseConfig, messagingVapidKey } from "./firebase-config.js";

const FB_VERSION = "11.5.0";

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getOrInitApp(appMod) {
  try {
    return appMod.getApp();
  } catch {
    return appMod.initializeApp(firebaseConfig);
  }
}

async function ensureFirestoreForPush() {
  if (!firebaseConfig) return null;
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
  const mod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
  const app = getOrInitApp(appMod);
  return { db: mod.getFirestore(app), api: mod };
}

/**
 * 將 FCM token 寫入 Firestore，供同步腳本對追蹤股發推播。
 */
export async function saveMessagingTokenForUser(uid, token) {
  if (!uid || !token) return;
  const fb = await ensureFirestoreForPush();
  if (!fb) return;
  const { db, api } = fb;
  const id = await sha256Hex(token);
  const ref = api.doc(db, "users", uid, "messagingTokens", id);
  await api.setDoc(ref, {
    token,
    updatedAt: api.serverTimestamp(),
    platform: "web"
  });
}

export function isPushUiAvailable() {
  return Boolean(
    firebaseConfig
    && messagingVapidKey
    && typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator
  );
}

function setStatus(el, text) {
  if (el) el.textContent = text || "";
}

let foregroundMessageBound = false;

/**
 * 綁定「開啟通知」按鈕；登入後呼叫一次即可。
 * @param {() => string | null} getUid 目前登入使用者的 uid
 */
export function bindPushNotificationControls({ getUid, button, statusEl }) {
  if (!button) return () => {};
  const row = button.closest?.(".push-notify-row");
  if (!isPushUiAvailable()) {
    if (row) row.hidden = true;
    return () => {};
  }

  const refresh = () => {
    const p = Notification.permission;
    if (row) row.hidden = p === "granted";
    if (p === "granted") {
      setStatus(statusEl, "已開啟通知");
      button.hidden = true;
    } else if (p === "denied") {
      setStatus(statusEl, "已被瀏覽器封鎖，請到網站設定允許通知。");
      button.hidden = true;
    } else {
      setStatus(statusEl, "");
      button.hidden = false;
    }
  };
  refresh();

  // 從瀏覽器設定關閉／開啟網站通知後，頁面不會自動重跑；回到分頁或權限變更時再檢查一次。
  const onVisibility = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onWindowFocus = () => refresh();
  window.addEventListener("focus", onWindowFocus);

  let disposed = false;
  /** @type {PermissionStatus | null} */
  let notificationPermStatus = null;
  try {
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((status) => {
          if (disposed) return;
          notificationPermStatus = status;
          status.addEventListener("change", refresh);
        })
        .catch(() => {});
    }
  } catch {
    // 部分瀏覽器不支援 notifications 的 permissions query
  }

  const onClick = async () => {
    const uid = typeof getUid === "function" ? getUid() : null;
    if (!uid) {
      setStatus(statusEl, "請先登入。");
      return;
    }
    button.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(statusEl, perm === "denied" ? "通知已遭拒絕。" : "未授予通知權限。");
        refresh();
        return;
      }
      const swUrl = new URL("./firebase-messaging-sw.js", window.location.href).href;
      const scope = new URL("./", window.location.href).href;
      const reg = await navigator.serviceWorker.register(swUrl, { scope });

      const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
      const msgMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-messaging.js`);
      const app = getOrInitApp(appMod);
      const messaging = msgMod.getMessaging(app);
      const token = await msgMod.getToken(messaging, {
        vapidKey: messagingVapidKey,
        serviceWorkerRegistration: reg
      });
      if (!token) {
        setStatus(statusEl, "無法取得推播權杖，請稍後再試。");
        return;
      }
      await saveMessagingTokenForUser(uid, token);
      setStatus(statusEl, "已註冊此裝置推播。");
      if (!foregroundMessageBound) {
        foregroundMessageBound = true;
        msgMod.onMessage(messaging, (payload) => {
          const title = payload.notification?.title || payload.data?.title || "狗狗財經";
          const body = payload.notification?.body || payload.data?.body || "";
          if (title && window.Notification?.permission === "granted") {
            new Notification(title, { body, icon: new URL("./icons/app-icon-192.png", window.location.href).href });
          }
        });
      }
    } catch (e) {
      console.warn("推播註冊失敗", e);
      setStatus(statusEl, `註冊失敗：${e?.message || e}`);
    } finally {
      button.disabled = false;
      refresh();
    }
  };
  button.addEventListener("click", onClick);
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onWindowFocus);
    if (notificationPermStatus) notificationPermStatus.removeEventListener("change", refresh);
    button.removeEventListener("click", onClick);
  };
}
