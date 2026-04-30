/* eslint-disable no-undef */
// 須與 js/firebase-config.js 的公開設定一致（Service Worker 無法 import ES 模組）。
importScripts("https://www.gstatic.com/firebasejs/11.5.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.5.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBm8rrWNou9xTJanpaLNRmE_LPSiMXTkbM",
  authDomain: "stock-app-a1999.firebaseapp.com",
  projectId: "stock-app-a1999",
  storageBucket: "stock-app-a1999.firebasestorage.app",
  messagingSenderId: "138053530951",
  appId: "1:138053530951:web:57a73987e5c7ce3ff6c862"
});

const messaging = firebase.messaging();

/** 相對路徑以 SW 註冊 scope 為基準（GitHub Pages 子路徑如 /StockAPP/ 才會正確） */
function resolveOpenUrl(raw) {
  const u = String(raw || "").trim() || "./index.html";
  try {
    if (/^https?:\/\//i.test(u)) {
      return new URL(u).href;
    }
    return new URL(u, self.registration.scope).href;
  } catch {
    return self.registration.scope;
  }
}

messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || "狗狗財經";
  const body = d.body || "";
  const link = d.url || "./index.html";
  const abs = resolveOpenUrl(link);
  const options = {
    body,
    icon: "./icons/app-icon-192.png",
    badge: "./icons/app-icon-192.png",
    data: { url: abs }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const abs = resolveOpenUrl(url);
      for (const client of clientList) {
        if (client.url === abs && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(abs);
      }
      return undefined;
    })
  );
});
