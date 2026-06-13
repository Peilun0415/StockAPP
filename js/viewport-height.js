function syncViewportHeight() {
  document.documentElement.style.setProperty("--app-vh", `${window.innerHeight * 0.01}px`);
}

syncViewportHeight();
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("orientationchange", syncViewportHeight);
window.visualViewport?.addEventListener("resize", syncViewportHeight);
