import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, activeLiveSession, ctxFor, persist } from "../app.js";
import { missingSettings } from "../settings.js";
import { REPORT_AFTER_ROUNDS, REPORT_AFTER_SESSIONS, createSession, reportUnlocked } from "../session.js";
import { DEFAULT_STAGE, LIFE_STAGES } from "../life-stage.js";

export function renderConsent(view, mode) {
  if (mode === "live") {
    if (missingSettings(app.settings, app.secrets).length) return go("#/settings");
    const active = activeLiveSession();
    if (active) return go(`#/session/${active.id}`);
  }
  // 上次选过的身份先勾上；情况变了可以改。
  let stage = app.data.profile.lifeStage ?? null;
  const start = () => {
    if (stage) app.data.profile.lifeStage = stage;
    const ctx = ctxFor(null);
    ctx.demo = mode === "demo";
    const session = createSession(ctx, app.data, mode, { lifeStage: stage ?? DEFAULT_STAGE });
    persist();
    go(`#/session/${session.id}`);
  };
  const stageQuestion = h(
    "fieldset",
    { class: "stage" },
    h("legend", {}, t("consent.stageQuestion")),
    h(
      "div",
      { class: "radios" },
      LIFE_STAGES.map((id) =>
        h(
          "label",
          { class: "radio" },
          h("input", { type: "radio", name: "life-stage", value: id, checked: stage === id, onChange: () => (stage = id) }),
          t(`consent.stages.${id}`),
        ),
      ),
    ),
    h("p", { class: "hint" }, t("consent.stageHint")),
  );
  mount(
    view,
    h("h1", {}, t("consent.title")),
    // 试玩：一开始就说清楚最后那份报告是什么样的（规则拼的示意、类别不写名字）。
    mode === "demo" ? [h("p", { class: "note" }, t("consent.demoNote")), h("p", { class: "note" }, t("consent.demoReport"))] : null,
    h("p", {}, t("consent.p1")),
    h("p", {}, t("consent.p2")),
    // 正式做的时候题目和回答会发给所选的服务商（作者的原话）；试玩不调用模型，不说这句。
    h("p", {}, t("consent.p3"), mode === "live" ? t("consent.provider") : null),
    // 正式做的时候先说清楚：报告要做满几轮、答满几组才能看。试玩做完就有报告，不用说。
    mode === "live" && !reportUnlocked(app.data) ? h("p", { class: "note" }, t("consent.reportAfter", { n: REPORT_AFTER_SESSIONS, g: REPORT_AFTER_ROUNDS })) : null,
    stageQuestion,
    h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onClick: start }, t("consent.start")), h("a", { class: "button ghost", href: "#/" }, t("common.back"))),
  );
}
