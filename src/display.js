// 显示偏好（亮暗、字号）：选了就生效，单独存，不用点"保存"，也不随记录导出。
// 页面一开头由 display-boot.js 先套上一次，免得深色模式先闪一下白；两边用同一个存储键。

const KEY = "hlcst.display.v1";
export const THEMES = ["system", "light", "dark"];
export const SIZES = ["normal", "large"];
const DEFAULTS = { theme: "system", size: "normal" };

export function loadDisplay() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { theme: THEMES.includes(d.theme) ? d.theme : DEFAULTS.theme, size: SIZES.includes(d.size) ? d.size : DEFAULTS.size };
  } catch {
    return { ...DEFAULTS };
  }
}

export function applyDisplay({ theme, size }) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  if (size === "large") root.setAttribute("data-size", "large");
  else root.removeAttribute("data-size");
}

export function saveDisplay(display) {
  localStorage.setItem(KEY, JSON.stringify(display));
  applyDisplay(display);
}
