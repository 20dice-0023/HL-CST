import { h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, confirmButton, persist } from "../app.js";
import { answeredRounds } from "../session.js";
import { dataTools } from "./data-tools.js";

export function renderHistory(view) {
  const render = () => {
    const sessions = app.data.sessions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const status = (s) => (s.mode === "demo" ? t("history.demo") : s.status === "done" ? t("history.done") : t("history.paused"));
    const list = sessions.length
      ? h(
          "ul",
          { class: "sessions" },
          sessions.map((s) =>
            h(
              "li",
              {},
              h(
                "span",
                { class: "session-label" },
                t(s.mode === "demo" ? "history.demoSession" : "history.session", {
                  n: s.number,
                  date: new Date(s.createdAt).toLocaleDateString("zh-CN"),
                  rounds: answeredRounds(s).length,
                  status: status(s),
                }),
              ),
              h(
                "span",
                { class: "session-actions" },
                s.status === "active" ? h("a", { class: "button small", href: `#/session/${s.id}` }, t("history.resume")) : null,
                s.mode === "demo" && s.report ? h("a", { class: "button ghost small", href: `#/report/demo/${s.id}` }, t("home.report")) : null,
                confirmButton(t("history.delete"), t(s.mode === "demo" ? "history.deleteConfirm" : "history.deleteConfirmLive"), () => {
                  app.data.sessions = app.data.sessions.filter((x) => x !== s);
                  if (s.mode === "live") {
                    // 报告是累计的：这一轮之后生成的报告都用到了这一轮的回答，一起删掉；批注也一样。
                    const { profile } = app.data;
                    const dropped = profile.reports.filter((r) => r.generatedAt >= s.createdAt);
                    profile.reports = profile.reports.filter((r) => r.generatedAt < s.createdAt);
                    for (const hyp of dropped.flatMap((r) => r.hypotheses)) delete profile.feedback[hyp.id];
                    for (const key of Object.keys(profile.annotations)) if (key.startsWith(`${s.id}:`)) delete profile.annotations[key];
                  }
                  persist();
                  render();
                }),
              ),
            ),
          ),
        )
      : h("p", { class: "muted" }, t("history.empty"));
    const reportLink = app.data.profile.reports.length ? h("p", {}, h("a", { class: "button ghost small", href: "#/report" }, t("home.report"))) : null;
    mount(view, h("h1", {}, t("history.title")), reportLink, list, h("section", { class: "card" }, h("h2", {}, t("report.s10.title")), dataTools(render)));
  };
  render();
}
