import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, findSession } from "../app.js";
import { reportUnlocked } from "../session.js";
import { axisLabel } from "../content.js";

// 某一轮结束时受试者留的话（报告概况里的链接）：原话，和觉得"像是换了个说法"的那几组题。
export function renderNotes(view, id) {
  const session = findSession(id);
  const ex = session?.end?.experience;
  // 正式做的这一页算报告的一部分：报告还没解锁时不给看。
  if (!ex || (session.mode === "live" && !reportUnlocked(app.data))) return go("#/");
  const back = session.mode === "demo" ? `#/report/demo/${id}` : "#/report";
  // 试玩报告里的这一页也不写类别的名字（和报告一样只写"第一类""第二类"）。
  const axisName = (aid) => axisLabel(app.content, aid, { masked: session.mode === "demo" });
  const rounds = (ex.repeatRounds ?? []).map((idx) => session.rounds.find((r) => r.index === idx)).filter(Boolean);

  mount(
    view,
    h("h1", {}, session.mode === "demo" ? t("notes.titleDemo") : t("notes.title", { n: session.number || 1 })),
    ex.pressure ? [h("h2", {}, t("notes.pressure")), h("blockquote", {}, h("p", {}, ex.pressure))] : null,
    rounds.length
      ? [
          h("h2", {}, t("notes.repeat")),
          rounds.map((r) =>
            h(
              "section",
              { class: "card" },
              h("h3", {}, t("notes.roundN", { n: r.index })),
              h(
                "ul",
                { class: "offered" },
                r.offered.map((o) => h("li", { class: o.qid === r.choice ? "chosen" : null }, o.text, o.qid === r.choice ? h("span", { class: "tag" }, t("notes.chosen")) : null)),
              ),
              r.choice === "skip" ? h("p", { class: "small muted" }, t("notes.skipped")) : null,
              h("p", { class: "small muted" }, t("notes.auditAxes", { axes: r.offered.map((o) => axisName(o.audit?.taggedAxis || o.axis)).join("、") })),
            ),
          ),
        ]
      : null,
    !ex.pressure && !rounds.length ? h("p", { class: "muted" }, t("notes.none")) : null,
    h("div", { class: "actions" }, h("a", { class: "button", href: back }, t("notes.back"))),
  );
}
