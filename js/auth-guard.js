import { isAuthAvailable, waitForAuthUser } from "./auth.js";

function buildLoginRedirect(returnTo) {
  const target = returnTo || (window.location.pathname + window.location.search);
  return `./login.html?redirect=${encodeURIComponent(target)}`;
}

export async function requireAuth(returnTo) {
  if (!isAuthAvailable()) {
    return null; // Firebase 未設定，讓頁面繼續照舊跑
  }

  try {
    const user = await waitForAuthUser();
    if (!user) {
      window.location.replace(buildLoginRedirect(returnTo));
      return null;
    }
    return user;
  } catch (error) {
    // Firebase 初始化失敗：不強制導向登入，避免跳轉迴圈
    console.warn("Auth guard：初始化失敗，取消強制登入", error);
    return null;
  }
}

