import { h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, activeLiveSession, contactNote, lockedNote } from "../app.js";
import { missingSettings } from "../settings.js";
import { answeredRounds, completedSessions, liveSessions, nextRoundIndex, nextSessionNumber, reportUnlocked } from "../session.js";

export function renderHome(view) {
  const { data } = app;
  const active = activeLiveSession();
  const lives = liveSessions(data);
  const answered = lives.reduce((n, s) => n + answeredRounds(s).length, 0);
  const missing = missingSettings(app.settings, app.secrets);

  const actions = [];
  if (active) {
    actions.push(h("a", { class: "button primary", href: `#/session/${active.id}` }, t("home.resume", { round: nextRoundIndex(active) ?? active.plan.length })));
  } else if (missing.length) {
    actions.push(h("a", { class: "button primary", href: "#/settings" }, t("home.goSettings")));
  } else {
    actions.push(h("a", { class: "button primary", href: "#/start" }, lives.length ? t("home.next", { n: nextSessionNumber(data) }) : t("home.start")));
  }
  // 前几轮不给看报告的入口（见 session.js 的 reportUnlocked），只说要做满多少、现在做到哪了。
  const unlocked = reportUnlocked(data);
  const done = completedSessions(data);
  if (answered > 0 && unlocked) actions.push(h("a", { class: "button", href: "#/report" }, t("home.report")));

  mount(
    view,
    h("section", { class: "hero" }, h("h1", {}, t("app.title")), h("p", { class: "subtitle" }, t("app.subtitle")), h("p", { class: "lead" }, t("home.intro"))),
    !active && missing.length ? h("p", { class: "note" }, t("home.needSettings")) : null,
    h("div", { class: "actions" }, actions),
    !unlocked && done > 0 ? h("p", { class: "muted small" }, lockedNote()) : null,
    h("section", { class: "demo" }, h("a", { class: "button ghost", href: "#/demo" }, t("home.demo")), h("p", { class: "muted small" }, t("home.demoNote"))),
    // 说明文档在网站里直接显示（views/how.js），打开前先说清楚看了以后的题会单独统计。
    h("p", { class: "muted small" }, h("a", { href: "#/how" }, t("home.howItWorks"))),
    contactNote(),
  );
}
