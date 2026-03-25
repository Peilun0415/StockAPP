// 請填入你的 Firebase 專案設定。
// 若保持 null，系統會自動改用 localStorage。
// （此專案由其他模組 dynamic import 初始化 Firebase）
export { firebaseConfig };

// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app"; // 此專案不使用靜態匯入，避免 GitHub Pages 環境解析失敗
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBm8rrWNou9xTJanpaLNRmE_LPSiMXTkbM",
  authDomain: "stock-app-a1999.firebaseapp.com",
  projectId: "stock-app-a1999",
  storageBucket: "stock-app-a1999.firebasestorage.app",
  messagingSenderId: "138053530951",
  appId: "1:138053530951:web:57a73987e5c7ce3ff6c862"
};

// Initialize Firebase（已移除，改由其他模組 dynamic import 初始化）