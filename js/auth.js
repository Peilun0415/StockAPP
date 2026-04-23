import { firebaseConfig } from "./firebase-config.js";

let authInstance = null;
let authMod = null;
let redirectResultHandled = false;

function canUseSessionStorage() {
  try {
    const key = "__stockapp_auth_test__";
    window.sessionStorage.setItem(key, "1");
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isIosBrowser() {
  const ua = navigator.userAgent || "";
  return /iP(ad|hone|od)/i.test(ua);
}

function shouldFallbackToRedirect(error) {
  const code = error?.code || "";
  return code === "auth/popup-blocked"
    || code === "auth/popup-closed-by-user"
    || code === "auth/cancelled-popup-request"
    || code === "auth/operation-not-supported-in-this-environment";
}

async function ensureAuth() {
  if (!firebaseConfig) {
    return null;
  }
  if (authInstance) {
    return authInstance;
  }

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js");
    const mod = await import("https://www.gstatic.com/firebasejs/11.5.0/firebase-auth.js");
    authMod = mod;
    const app = initializeApp(firebaseConfig);
    authInstance = mod.getAuth(app);
    return authInstance;
  } catch (error) {
    console.warn("Firebase Auth 初始化失敗", error);
    return null;
  }
}

export function isAuthAvailable() {
  return Boolean(firebaseConfig);
}

export async function signInWithGoogle() {
  const auth = await ensureAuth();
  if (!auth || !authMod) {
    throw new Error("Firebase Auth 未設定完成或初始化失敗");
  }
  const provider = new authMod.GoogleAuthProvider();
  // iOS / 行動瀏覽器優先嘗試 popup，失敗再改 redirect。
  try {
    return await authMod.signInWithPopup(auth, provider);
  } catch (error) {
    if (!shouldFallbackToRedirect(error)) {
      throw error;
    }
    // redirect 流程仰賴 sessionStorage，若不可用會出現 missing initial state。
    if (!canUseSessionStorage()) {
      throw new Error("目前瀏覽器限制了登入所需的儲存空間，請改用 Safari 開啟或關閉無痕模式後再試。");
    }
    await authMod.signInWithRedirect(auth, provider);
    return null;
  }
}

export async function signOutGoogle() {
  const auth = await ensureAuth();
  if (!auth) {
    return;
  }
  return authMod.signOut(auth);
}

export async function getCurrentUid() {
  const auth = await ensureAuth();
  const user = auth?.currentUser ?? null;
  return user ? user.uid : null;
}

export async function waitForAuthUser() {
  const auth = await ensureAuth();
  if (!auth || !authMod) {
    // 區分：不是「未登入」，而是「Auth 初始化失敗」
    throw new Error("Firebase Auth initialization failed");
  }

  // 等待第一次 onAuthStateChanged，拿到目前登入使用者（或 null）
  return new Promise((resolve) => {
    const unsub = authMod.onAuthStateChanged(auth, (user) => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
      resolve(user || null);
    });
  });
}

function setBtnState(btn, { text, disabled }) {
  if (!btn) return;
  if (text != null) {
    const label = btn.querySelector?.(".auth-btn-label");
    if (label) {
      label.textContent = text;
    } else {
      btn.textContent = text;
    }
    const gIcon = btn.querySelector?.(".google-g");
    if (gIcon) {
      // 僅列表／明細頁頂欄：已登入（顯示「登出」）不顯示 Google 圖；登入頁 login-google-btn 維持原樣
      const isListOrDetailTopBar = btn.classList?.contains("login-btn");
      gIcon.hidden = Boolean(isListOrDetailTopBar && text === "登出");
    }
  }
  btn.disabled = Boolean(disabled);
}

function renderAuthUserText(user) {
  if (!user) return "未登入";
  const email = user.email || user.displayName || "已登入";
  return `已登入：${email}`;
}

export async function initGoogleAuthUI({ authBtn, authUserEl, avatarEl, onUserChanged, appBarOnlyLogout = false }) {
  const auth = await ensureAuth();
  if (!auth || !authMod) {
    if (appBarOnlyLogout) {
      setBtnState(authBtn, { text: "登出（未設定）", disabled: true });
    } else {
      setBtnState(authBtn, { text: "登入 Google（未設定）", disabled: true });
    }
    if (authUserEl) authUserEl.textContent = "未設定 Firebase Auth";
    if (avatarEl) {
      avatarEl.style.display = "none";
      avatarEl.src = "";
    }
    // 仍讓外層可繼續跑（用 localStorage）
    onUserChanged?.(null);
    return null;
  }

  if (!redirectResultHandled) {
    redirectResultHandled = true;
    try {
      await authMod.getRedirectResult(auth);
    } catch (error) {
      // iOS 某些環境會缺失 initial state，忽略這筆結果讓使用者可重新登入。
      if (error?.code !== "auth/missing-initial-state") {
        console.warn("讀取 redirect 登入結果失敗", error);
      } else if (isIosBrowser()) {
        console.warn("iOS 瀏覽器缺少 redirect initial state，請重新嘗試登入");
      }
    }
  }

  let first = true;

  const initial = await new Promise((resolve) => {
    authMod.onAuthStateChanged(auth, (user) => {
      if (first) {
        first = false;
        resolve(user || null);
      }
      if (authUserEl) authUserEl.textContent = renderAuthUserText(user);
      if (avatarEl) {
        if (user?.photoURL) {
          avatarEl.src = user.photoURL;
          avatarEl.style.display = "block";
        } else {
          avatarEl.style.display = "none";
          avatarEl.src = "";
        }
      }
      if (appBarOnlyLogout) {
        // 列表／明細頁：有 requireAuth 擋未登入，按鈕在 HTML 固定寫「登出」，不切換成登入文案
        setBtnState(authBtn, { disabled: false });
      } else if (user) {
        setBtnState(authBtn, { text: "登出", disabled: false });
      } else {
        setBtnState(authBtn, { text: "Google 登入", disabled: false });
      }
      onUserChanged?.(user || null);
    });
  });

  if (authBtn) {
    authBtn.addEventListener("click", async () => {
      try {
        setBtnState(authBtn, { disabled: true });
        const user = auth.currentUser;
        if (user) {
          await signOutGoogle();
        } else if (!appBarOnlyLogout) {
          await signInWithGoogle();
        }
      } catch (error) {
        console.warn(error);
        alert(`登入/登出失敗：${error?.message || error}`);
      } finally {
        setBtnState(authBtn, { disabled: false });
      }
    });
  }

  return initial;
}

