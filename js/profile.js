import { isAuthAvailable, signOutGoogle, subscribeAuthUser } from "./auth.js";
import { requireAuth } from "./auth-guard.js";

const pageLoadingEl = document.querySelector("#pageLoading");
const profileAvatarEl = document.querySelector("#profileAvatar");
const profileAvatarFallbackEl = document.querySelector("#profileAvatarFallback");
const profileNameEl = document.querySelector("#profileName");
const profileEmailEl = document.querySelector("#profileEmail");
const logoutBtnEl = document.querySelector("#logoutBtn");

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

function getInitial(name, email) {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase();
}

function showAvatarFallback(initial) {
  profileAvatarEl.hidden = true;
  profileAvatarEl.removeAttribute("src");
  profileAvatarFallbackEl.textContent = initial;
  profileAvatarFallbackEl.hidden = false;
}

function showAvatarPhoto(url, fallbackInitial) {
  profileAvatarFallbackEl.hidden = true;
  profileAvatarEl.onerror = () => {
    showAvatarFallback(fallbackInitial);
  };
  profileAvatarEl.src = url;
  profileAvatarEl.hidden = false;
}

function renderProfile(user) {
  if (!user) {
    profileNameEl.textContent = "未登入";
    profileEmailEl.textContent = "—";
    showAvatarFallback("?");
    return;
  }

  const name = user.displayName || "使用者";
  const email = user.email || "—";
  const initial = getInitial(name, email);
  profileNameEl.textContent = name;
  profileEmailEl.textContent = email;

  if (user.photoURL) {
    showAvatarPhoto(user.photoURL, initial);
  } else {
    showAvatarFallback(initial);
  }
}

async function boot() {
  try {
    setPageLoading(true);
    const user = await requireAuth("./profile.html");
    renderProfile(user);

    logoutBtnEl.addEventListener("click", async () => {
      try {
        logoutBtnEl.disabled = true;
        await signOutGoogle();
        window.location.replace("./login.html?redirect=" + encodeURIComponent("./profile.html"));
      } catch (error) {
        console.warn(error);
        alert(`登出失敗：${error?.message || error}`);
        logoutBtnEl.disabled = false;
      }
    });

    await subscribeAuthUser((u) => {
      renderProfile(u);
      if (!u && isAuthAvailable()) {
        window.location.replace("./login.html?redirect=" + encodeURIComponent("./profile.html"));
      }
    });
  } finally {
    setPageLoading(false);
  }
}

boot();
