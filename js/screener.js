import { initGoogleAuthUI, isAuthAvailable } from "./auth.js";
import { requireAuth } from "./auth-guard.js";

const authBtn = document.querySelector("#authBtn");
const authAvatarEl = document.querySelector("#authAvatar");
const pageLoadingEl = document.querySelector("#pageLoading");

function setPageLoading(show) {
  if (!pageLoadingEl) return;
  pageLoadingEl.classList.toggle("is-hidden", !show);
}

async function boot() {
  try {
    setPageLoading(true);
    await requireAuth();
    initGoogleAuthUI({
      authBtn,
      authUserEl: null,
      avatarEl: authAvatarEl,
      appBarOnlyLogout: true,
      onUserChanged: (u) => {
        // 登出後直接回到登入頁，避免在未登入狀態停留
        if (!u && isAuthAvailable()) {
          const returnTo = window.location.pathname + window.location.search;
          window.location.replace(`./login.html?redirect=${encodeURIComponent(returnTo)}`);
        }
      }
    });
    // TODO: 在這裡實作個股篩選功能
  } finally {
    setPageLoading(false);
  }
}

boot();
