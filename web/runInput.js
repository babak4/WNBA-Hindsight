// Rules for the "run size" text box. Pure functions (no DOM) so they can be unit tested;
// app.js applies them to the real input.
import { RUN_MIN_ALLOWED, RUN_MAX_ALLOWED, clampRunSize } from "./model.js";

/** Text that may exist in the box while typing: empty, or 1-2 digits, no leading zero, at most the maximum. */
export function isAllowedText(text) {
  return text === "" || (/^[1-9]\d?$/.test(text) && Number(text) <= RUN_MAX_ALLOWED);
}

/**
 * The text after inserting `inserted` over the selection [start, end), or null if that edit is not allowed.
 * Anything other than the digits 0-9 is rejected outright (typed text). With { paste: true } non-digits are
 * stripped from the inserted text first and the rest is inserted if it is allowed.
 */
export function applyInsert(current, start, end, inserted, { paste = false } = {}) {
  const digits = paste ? inserted.replace(/\D/g, "") : inserted;
  if (!/^\d+$/.test(digits)) return null;
  const text = current.slice(0, start) + digits + current.slice(end);
  return isAllowedText(text) ? { text, caret: start + digits.length } : null;
}

/** The run size to use while the box holds `text`: a whole number from 3 to 40, or null if it is incomplete (empty, 1, 2). */
export function liveRunSize(text) {
  if (!/^[1-9]\d?$/.test(text)) return null;
  const n = Number(text);
  return n >= RUN_MIN_ALLOWED && n <= RUN_MAX_ALLOWED ? n : null;
}

/** What to settle on when the user leaves the box: the clamped number, or `fallback` if it is empty. */
export function commitRunSize(text, fallback) {
  const n = parseInt(text, 10);
  return Number.isNaN(n) ? fallback : clampRunSize(n);
}
