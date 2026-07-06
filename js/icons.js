export const MARK_KEYS = ["check", "star", "cross"];

const LEGACY_MARK_MAP = {
  "✔️": "check",
  "⭐": "star",
  "❌": "cross"
};

export function normalizeMark(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (MARK_KEYS.includes(raw)) return raw;
  return LEGACY_MARK_MAP[raw] || "";
}

export function markIconSvg(key, className = "ui-icon") {
  if (key === "check") {
    return `<svg class="${className} ui-icon--check" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.55 16.2 5.25 11.9l1.4-1.425 2.9 2.9 7.05-7.05 1.425 1.4z"/></svg>`;
  }
  if (key === "star") {
    return `<svg class="${className} ui-icon--star" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 17.27 4.15 2.49-.99-4.73 3.45-2.98-4.55-.39L12 7.5 9.94 11.66l-4.55.39 3.45 2.98-.99 4.73z"/></svg>`;
  }
  if (key === "cross") {
    return `<svg class="${className} ui-icon--cross" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.18 12 2.89 5.71 4.3 4.3l6.29 6.29 6.29-6.29z"/></svg>`;
  }
  return "";
}

export function renderMarkCell(mark) {
  const key = normalizeMark(mark);
  return key ? markIconSvg(key, "mark-icon") : "";
}

export const iconClose = `<svg class="ui-icon ui-icon--close" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.18 12 2.89 5.71 4.3 4.3l6.29 6.29 6.29-6.29z"/></svg>`;

export const iconEdit = `<svg class="ui-icon ui-icon--edit" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>`;

export const iconDelete = `<svg class="ui-icon ui-icon--delete" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

export const iconCalendar = `<svg class="ui-icon ui-icon--calendar" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3zm13 8H4v10h16z"/></svg>`;
