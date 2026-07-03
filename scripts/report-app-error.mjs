/**
 * 將錯誤寫入 Firestore appErrors（供 CI 或本機腳本使用）。
 * 用法：node scripts/report-app-error.mjs <source> <message> [detail]
 */
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function initAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const cred = JSON.parse(raw);
    initializeApp({ credential: cert(cred) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

async function main() {
  const source = process.argv[2] || "script";
  const message = process.argv[3] || "unknown error";
  const detail = process.argv[4] || null;
  initAdmin();
  const db = getFirestore();
  await db.collection("appErrors").add({
    source: String(source),
    message: String(message).slice(0, 500),
    detail: detail ? String(detail).slice(0, 1000) : null,
    stack: null,
    url: process.env.GITHUB_ACTIONS ? process.env.GITHUB_SERVER_URL : null,
    userAgent: process.env.GITHUB_WORKFLOW || "node-script",
    uid: null,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`[report-app-error] logged: ${source}`);
}

main().catch((error) => {
  console.error("[report-app-error] failed", error);
  process.exitCode = 1;
});
