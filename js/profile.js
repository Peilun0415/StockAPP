import { isAuthAvailable, signOutGoogle, subscribeAuthUser } from "./auth.js";
import { requireAuth } from "./auth-guard.js";
import {
  ADMIN_ERROR_VIEWER_UID,
  installGlobalErrorReporting,
  loadRecentAppErrors
} from "./app-error-store.js";

const pageLoadingEl = document.querySelector("#pageLoading");
const profileAvatarEl = document.querySelector("#profileAvatar");
const profileAvatarFallbackEl = document.querySelector("#profileAvatarFallback");
const profileNameEl = document.querySelector("#profileName");
const profileEmailEl = document.querySelector("#profileEmail");
const logoutBtnEl = document.querySelector("#logoutBtn");
const adminErrorPanelEl = document.querySelector("#adminErrorPanel");
const adminErrorListEl = document.querySelector("#adminErrorList");
const adminErrorEmptyEl = document.querySelector("#adminErrorEmpty");

let currentUid = null;

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

function formatErrorTime(value) {
  if (!value) return "—";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-TW", { hour12: false });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderAdminErrors() {
  if (!adminErrorPanelEl || currentUid !== ADMIN_ERROR_VIEWER_UID) {
    if (adminErrorPanelEl) adminErrorPanelEl.hidden = true;
    return;
  }

  adminErrorPanelEl.hidden = false;
  const rows = await loadRecentAppErrors(40);
  if (!rows.length) {
    adminErrorListEl.innerHTML = "";
    adminErrorEmptyEl.hidden = false;
    return;
  }

  adminErrorEmptyEl.hidden = true;
  adminErrorListEl.innerHTML = rows.map((row) => `
    <li class="profile-error-item">
      <p class="profile-error-meta">${escapeHtml(formatErrorTime(row.createdAt))} · ${escapeHtml(row.source || "unknown")}${row.uid ? ` · ${escapeHtml(row.uid)}` : ""}</p>
      <p class="profile-error-message">${escapeHtml(row.message || "—")}</p>
      ${row.detail ? `<p class="profile-error-message">${escapeHtml(row.detail)}</p>` : ""}
    </li>
  `).join("");
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
    installGlobalErrorReporting(() => currentUid);
    const user = await requireAuth("./profile.html");
    currentUid = user?.uid ?? null;
    renderProfile(user);
    await renderAdminErrors();

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

    subscribeAuthUser(async (u) => {
      currentUid = u?.uid ?? null;
      renderProfile(u);
      await renderAdminErrors();
      if (!u && isAuthAvailable()) {
        window.location.replace("./login.html?redirect=" + encodeURIComponent("./profile.html"));
      }
    });
  } finally {
    setPageLoading(false);
  }
}

boot();
