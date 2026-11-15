// 在页面画出来之前套上亮暗和字号设置（见 src/display.js），免得深色模式先闪一下白。
// 普通脚本、同步执行，所以写得尽量短；读不到就什么都不做，按系统设置显示。
(function () {
  try {
    var d = JSON.parse(localStorage.getItem("hlcst.display.v1") || "{}");
    var root = document.documentElement;
    if (d.theme === "light" || d.theme === "dark") root.setAttribute("data-theme", d.theme);
    if (d.size === "large") root.setAttribute("data-size", "large");
  } catch (e) {
    // 存储不可用时按默认显示
  }
})();
