import { firebaseConfig } from "./firebase-config.js";

let authInstance = null;
let authMod = null;

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
  // 會用彈出視窗完成登入；GitHub Pages/某些瀏覽器可能會擋彈出視窗
  return authMod.signInWithPopup(auth, provider);
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
  if (text != null) btn.textContent = text;
  btn.disabled = Boolean(disabled);
}

function renderAuthUserText(user) {
  if (!user) return "未登入";
  const email = user.email || user.displayName || "已登入";
  return `已登入：${email}`;
}

export async function initGoogleAuthUI({ authBtn, authUserEl, avatarEl, onUserChanged }) {
  const auth = await ensureAuth();
  if (!auth || !authMod) {
    setBtnState(authBtn, { text: "登入 Google（未設定）", disabled: true });
    if (authUserEl) authUserEl.textContent = "未設定 Firebase Auth";
    if (avatarEl) {
      avatarEl.style.display = "none";
      avatarEl.src = "";
    }
    // 仍讓外層可繼續跑（用 localStorage）
    onUserChanged?.(null);
    return null;
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
      if (user) {
        setBtnState(authBtn, { text: "登出", disabled: false });
      } else {
        setBtnState(authBtn, { text: "登入 Google", disabled: false });
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
        } else {
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

