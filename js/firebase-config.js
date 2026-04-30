// 請填入你的 Firebase 專案設定。
// 若保持 null，系統會自動改用 localStorage。
// （此專案由其他模組 dynamic import 初始化 Firebase）

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBm8rrWNou9xTJanpaLNRmE_LPSiMXTkbM",
  authDomain: "stock-app-a1999.firebaseapp.com",
  projectId: "stock-app-a1999",
  storageBucket: "stock-app-a1999.firebasestorage.app",
  messagingSenderId: "138053530951",
  appId: "1:138053530951:web:57a73987e5c7ce3ff6c862"
};

/**
 * Firebase Console → 專案設定 → 雲端通訊 → Web 設定憑證 → 產生金鑰組 → 此處貼上「金鑰組」的公開金鑰字串。
 * 未設定時推播 UI 會隱藏，同步腳本仍可執行但不會發送 FCM。
 */
export const messagingVapidKey = "BBQ-BG0vQ1idzv8nHskvgCKbRpaM0dPJE_auNz_L_RIVa5t0dqh3V7oD2MUqAsm9Aw_sJcmkZfJcz-pWqtLiuTk";

export { firebaseConfig };
