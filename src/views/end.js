import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, findSession, lockedNote, persist } from "../app.js";
import { answeredRounds, chosenQuestion, finishSession, nextRoundIndex, reportUnlocked } from "../session.js";

export function renderEnd(view, id) {
  const session = findSession(id);
  if (!session) return go("#/");
  if (session.status !== "done") return experienceForm();
  return afterEnd();

  function experienceForm() {
    const checks = answeredRounds(session).map((r) => {
      const q = chosenQuestion(r);
      const box = h("input", { type: "checkbox", value: String(r.index) });
      const label = `${t("report.card.roundN", { n: r.index })}：${q ? `${q.text.slice(0, 24)}……` : t("review.skipped")}`;
      return { box, el: h("label", { class: "check" }, box, label) };
    });
    const pressure = h("textarea", { rows: 3, "aria-label": t("end.pressureQuestion"), placeholder: t("end.pressurePlaceholder") });
    let readAxes = null;
    const askReadAxes = session.mode === "live" && app.data.profile.readAxes === null;
    const readAxesRadio = (value, label) =>
      h("label", { class: "radio" }, h("input", { type: "radio", name: "read-axes", onChange: () => (readAxes = value) }), label);

    const finish = () => {
      finishSession(session, {
        reason: nextRoundIndex(session) === null ? "completed" : "ended",
        experience: {
          repeatRounds: checks.filter((c) => c.box.checked).map((c) => Number(c.box.value)),
          pressure: pressure.value.trim(),
        },
      });
      if (readAxes !== null) app.data.profile.readAxes = readAxes;
      persist();
      renderEnd(view, id);
    };

    mount(
      view,
      h("h1", {}, t("end.title")),
      checks.length ? [h("h2", {}, t("end.repeatQuestion")), h("p", { class: "muted" }, t("end.repeatHint")), h("div", { class: "checks" }, checks.map((c) => c.el))] : null,
      h("h2", {}, t("end.pressureQuestion")),
      pressure,
      askReadAxes ? [h("h2", {}, t("end.readAxesQuestion")), h("div", { class: "radios" }, readAxesRadio(true, t("end.readAxesYes")), readAxesRadio(false, t("end.readAxesNo")))] : null,
      h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onClick: finish }, t("common.continue"))),
    );
  }

  function afterEnd() {
    if (session.mode === "demo") return go(`#/report/demo/${id}`);
    if (app.data.profile.firstReportAt) return go("#/report");
    // 前几轮不给看报告的入口；做满了，看不看、什么时候看由受试者定。
    if (!reportUnlocked(app.data)) {
      return mount(
        view,
        h("h1", {}, t("end.timingTitle")),
        h("p", {}, lockedNote()),
        h("p", { class: "muted" }, t("end.lockedWhy")),
        h("div", { class: "actions" }, h("a", { class: "button primary", href: "#/" }, t("nav.home"))),
      );
    }
    mount(
      view,
      h("h1", {}, t("end.timingTitle")),
      h("p", {}, t("end.unlocked")),
      h("div", { class: "actions" }, h("a", { class: "button primary", href: "#/predict" }, t("end.viewNow")), h("a", { class: "button ghost", href: "#/" }, t("end.viewLater"))),
    );
  }
}
