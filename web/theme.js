// Dark/light theme checkbox. index.html sets data-theme before first paint; this wires the control.
const KEY = "hindsight-theme";
const dark = matchMedia("(prefers-color-scheme: dark)");

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch { return null; } // storage can be blocked (private windows etc.)
}

export function initTheme(checkbox) {
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    checkbox.checked = theme === "dark";
  };
  apply(document.documentElement.dataset.theme || (dark.matches ? "dark" : "light"));

  checkbox.addEventListener("change", () => {
    const theme = checkbox.checked ? "dark" : "light";
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* choice just won't persist */ }
  });

  // With no saved choice, keep following the OS setting.
  dark.addEventListener("change", () => { if (!read()) apply(dark.matches ? "dark" : "light"); });
}
