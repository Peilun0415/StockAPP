/**
 * 分段日期輸入：年滿 4 碼→月、月滿 2 碼→日；並可透過 type=date 日曆選取。
 * 實際送出值寫在隱藏欄 name 與原本 input[type=date] 相同（yyyy-mm-dd）。
 */

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function isValidYmd(y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function parseToYmd(value) {
  const t = String(value || "").trim();
  if (!t) return null;
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    return isValidYmd(y, mo, d) ? { y, m: mo, d } : null;
  }
  const m2 = t.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m2) {
    const y = Number(m2[1]);
    const mo = Number(m2[2]);
    const d = Number(m2[3]);
    return isValidYmd(y, mo, d) ? { y, m: mo, d } : null;
  }
  return null;
}

function ymdToIso(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function emitHiddenEvents(hidden) {
  if (!hidden) return;
  hidden.dispatchEvent(new Event("input", { bubbles: true }));
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncHiddenFromParts(wrap) {
  const yEl = wrap.querySelector(".date-part-y");
  const mEl = wrap.querySelector(".date-part-m");
  const dEl = wrap.querySelector(".date-part-d");
  const hidden = wrap.querySelector('input[type="hidden"]');
  const native = wrap.querySelector(".date-native-pick");
  if (!yEl || !mEl || !dEl || !hidden) return;
  const ys = digitsOnly(yEl.value);
  const ms = digitsOnly(mEl.value);
  const ds = digitsOnly(dEl.value);
  if (ys.length !== 4 || ms.length !== 2 || ds.length !== 2) {
    hidden.value = "";
    if (native) native.value = "";
    emitHiddenEvents(hidden);
    return;
  }
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!isValidYmd(y, m, d)) {
    hidden.value = "";
    if (native) native.value = "";
    emitHiddenEvents(hidden);
    return;
  }
  const iso = ymdToIso(y, m, d);
  hidden.value = iso;
  if (native) native.value = iso;
  emitHiddenEvents(hidden);
}

function clampMonth(ms) {
  let v = Number(ms);
  if (!Number.isFinite(v)) return "01";
  if (v < 1) v = 1;
  if (v > 12) v = 12;
  return pad2(v);
}

function clampDay(y, m, ds) {
  let v = Number(ds);
  const maxD = daysInMonth(y, m);
  if (!Number.isFinite(v)) return pad2(1);
  if (v < 1) v = 1;
  if (v > maxD) v = maxD;
  return pad2(v);
}

function bindOneWrap(wrap) {
  if (wrap.dataset.dateInited === "1") return;
  wrap.dataset.dateInited = "1";
  const yEl = wrap.querySelector(".date-part-y");
  const mEl = wrap.querySelector(".date-part-m");
  const dEl = wrap.querySelector(".date-part-d");
  const hidden = wrap.querySelector('input[type="hidden"]');
  const native = wrap.querySelector(".date-native-pick");
  if (!yEl || !mEl || !dEl || !hidden) return;

  yEl.addEventListener("input", () => {
    yEl.value = digitsOnly(yEl.value).slice(0, 4);
    if (yEl.value.length >= 4) {
      yEl.value = yEl.value.slice(0, 4);
      mEl.focus();
      mEl.select?.();
    }
    syncHiddenFromParts(wrap);
  });

  mEl.addEventListener("input", () => {
    mEl.value = digitsOnly(mEl.value).slice(0, 2);
    if (mEl.value.length >= 2) {
      mEl.value = clampMonth(mEl.value);
      dEl.focus();
      dEl.select?.();
    }
    syncHiddenFromParts(wrap);
  });

  dEl.addEventListener("input", () => {
    dEl.value = digitsOnly(dEl.value).slice(0, 2);
    const ys = digitsOnly(yEl.value);
    const ms = digitsOnly(mEl.value);
    if (ys.length === 4 && ms.length === 2 && dEl.value.length >= 2) {
      const y = Number(ys);
      const m = Number(clampMonth(ms));
      dEl.value = clampDay(y, m, dEl.value);
    }
    syncHiddenFromParts(wrap);
  });

  yEl.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && yEl.value === "" && document.activeElement === yEl) {
      /* stay */
    }
  });
  mEl.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && mEl.value === "" && document.activeElement === mEl) {
      e.preventDefault();
      yEl.focus();
      yEl.setSelectionRange?.(yEl.value.length, yEl.value.length);
    }
  });
  dEl.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && dEl.value === "" && document.activeElement === dEl) {
      e.preventDefault();
      mEl.focus();
      mEl.setSelectionRange?.(mEl.value.length, mEl.value.length);
    }
  });

  yEl.addEventListener("blur", () => syncHiddenFromParts(wrap));
  mEl.addEventListener("blur", () => {
    const ms = digitsOnly(mEl.value);
    if (ms.length === 1) mEl.value = pad2(Number(ms));
    if (digitsOnly(mEl.value).length === 2) mEl.value = clampMonth(mEl.value);
    syncHiddenFromParts(wrap);
  });
  dEl.addEventListener("blur", () => {
    let ms = digitsOnly(mEl.value);
    if (ms.length === 1) mEl.value = pad2(Number(ms));
    ms = digitsOnly(mEl.value);
    const ys = digitsOnly(yEl.value);
    if (ys.length === 4 && ms.length === 2) {
      const y = Number(ys);
      const m = Number(clampMonth(ms));
      let ds = digitsOnly(dEl.value);
      if (ds.length === 1) dEl.value = pad2(Number(ds));
      ds = digitsOnly(dEl.value);
      if (ds.length === 2) dEl.value = clampDay(y, m, ds);
    }
    syncHiddenFromParts(wrap);
  });

  native?.addEventListener("change", () => {
    const v = native.value;
    if (!v) {
      setDateFieldValue(wrap, "");
      return;
    }
    setDateFieldValue(wrap, v);
  });
}

/**
 * @param {ParentNode} [root]
 */
export function initDateSegmentFields(root = document) {
  root.querySelectorAll(".date-segment-field").forEach((wrap) => bindOneWrap(wrap));
}

/**
 * @param {HTMLElement|null} wrap
 * @param {string} value yyyy-mm-dd 或 yyyy/mm/dd 或空字串
 */
export function setDateFieldValue(wrap, value) {
  if (!wrap) return;
  const yEl = wrap.querySelector(".date-part-y");
  const mEl = wrap.querySelector(".date-part-m");
  const dEl = wrap.querySelector(".date-part-d");
  const hidden = wrap.querySelector('input[type="hidden"]');
  const native = wrap.querySelector(".date-native-pick");
  const parsed = parseToYmd(value);
  if (!parsed) {
    if (yEl) yEl.value = "";
    if (mEl) mEl.value = "";
    if (dEl) dEl.value = "";
    if (hidden) hidden.value = "";
    if (native) native.value = "";
    if (hidden) emitHiddenEvents(hidden);
    return;
  }
  const { y, m, d } = parsed;
  if (yEl) yEl.value = String(y);
  if (mEl) mEl.value = pad2(m);
  if (dEl) dEl.value = pad2(d);
  const iso = ymdToIso(y, m, d);
  if (hidden) hidden.value = iso;
  if (native) native.value = iso;
  if (hidden) emitHiddenEvents(hidden);
}

/**
 * @param {HTMLElement|null} wrap
 * @param {boolean} readOnly
 */
export function setDateFieldReadOnly(wrap, readOnly) {
  if (!wrap) return;
  wrap.querySelectorAll(".date-part-y, .date-part-m, .date-part-d").forEach((el) => {
    el.readOnly = Boolean(readOnly);
  });
  const btn = wrap.querySelector(".date-cal-btn");
  if (btn) btn.disabled = Boolean(readOnly);
  const native = wrap.querySelector(".date-native-pick");
  if (native) native.disabled = Boolean(readOnly);
  const slot = wrap.querySelector(".date-cal-slot");
  if (slot) slot.classList.toggle("date-cal-slot--disabled", Boolean(readOnly));
}

/**
 * @param {HTMLFormElement|null} form
 */
export function resetDateFieldsInForm(form) {
  if (!form) return;
  form.querySelectorAll(".date-segment-field").forEach((wrap) => {
    setDateFieldValue(wrap, "");
  });
}
