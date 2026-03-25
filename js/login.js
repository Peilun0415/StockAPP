import { initGoogleAuthUI } from "./auth.js";

const authBtn = document.querySelector("#authBtn");
const authUserEl = document.querySelector("#authUser");
const params = new URLSearchParams(window.location.search);
const redirect = params.get("redirect") || "./index.html";

async function boot() {
  initGoogleAuthUI({
    authBtn,
    authUserEl,
    onUserChanged: (user) => {
      if (user) {
        window.location.replace(redirect);
      }
    }
  });
}

boot();

