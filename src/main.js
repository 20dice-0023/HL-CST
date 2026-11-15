// 入口：读内容、读本地记录、搭页面框架、按地址栏 # 后面的路径显示页面。

import { loadContent } from "./content.js";
import { setUI, t } from "./i18n.js";
import { loadData, loadSecrets, loadSettingsRaw } from "./store.js";
import { normalizeSettings } from "./settings.js";
import { h, mount } from "./dom.js";
import { app } from "./app.js";
import { renderHome } from "./views/home.js";
import { renderSettings } from "./views/settings.js";
import { renderConsent } from "./views/consent.js";
import { renderSession } from "./views/session.js";
import { renderEnd } from "./views/end.js";
import { renderPredict } from "./views/predict.js";
import { renderReport } from "./views/report.js";
import { renderReview } from "./views/review.js";
import { renderHistory } from "./views/history.js";
import { renderNotes } from "./views/notes.js";
import { renderHow } from "./views/how.js";

// 源码地址：代码按 AGPL 授权，网站上要让用的人能拿到源码（修订记录第 21 轮，仓库公开以后才加）。
const REPO_URL = "https://github.com/20dice-0023/HL-CST";

const ROUTES = {
  "": renderHome,
  settings: renderSettings,
  start: (view) => renderConsent(view, "live"),
  demo: (view) => renderConsent(view, "demo"),
  session: renderSession,
  end: renderEnd,
  predict: renderPredict,
  report: renderReport,
  review: renderReview,
  notes: renderNotes,
  history: renderHistory,
  how: renderHow,
};

let viewEl = null;

function shell() {
  const view = h("main", { id: "view" });
  mount(
    document.getElementById("app"),
    h(
      "header",
      { class: "site" },
      h("a", { href: "#/", class: "brand" }, t("app.title")),
      h("nav", {}, h("a", { href: "#/" }, t("nav.home")), h("a", { href: "#/history" }, t("nav.history")), h("a", { href: "#/settings" }, t("nav.settings"))),
    ),
    view,
    h("footer", { class: "site" }, t("app.footer"), " · ", h("a", { href: REPO_URL, target: "_blank", rel: "noopener noreferrer" }, t("app.source"))),
  );
  return view;
}

function route() {
  app.nav++;
  const [name = "", ...args] = location.hash.replace(/^#\/?/, "").split("/");
  const render = ROUTES[name] ?? renderHome;
  window.scrollTo(0, 0);
  render(viewEl, ...args);
}

async function boot() {
  try {
    app.content = await loadContent("zh");
  } catch (e) {
    console.error(e);
    mount(
      document.getElementById("app"),
      h(
        "p",
        { class: "boot error" },
        "内容文件读取失败。请在仓库根目录运行 node tools/serve.mjs，再打开 http://localhost:8000 。",
        h("br"),
        "Failed to load content files. Serve the repository over HTTP (e.g. node tools/serve.mjs).",
      ),
    );
    return;
  }
  setUI(app.content.ui);
  app.data = loadData();
  app.settings = normalizeSettings(loadSettingsRaw());
  app.secrets = loadSecrets();
  viewEl = shell();
  window.addEventListener("hashchange", route);
  route();
}

boot();
