import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, persist } from "../app.js";
import { now, reportUnlocked } from "../session.js";

// 第一次看报告之前的自我预测（输出规格 1.6）。做完这一步就知道了轴，之后的选择都算知情后。
export function renderPredict(view) {
  if (app.data.profile.firstReportAt) return go("#/report");
  if (!reportUnlocked(app.data)) return go("#/");
  const most = new Set();
  const least = new Set();
  const buttons = [];

  const refresh = () => {
    for (const b of buttons) {
      const set = b.kind === "most" ? most : least;
      const on = set.has(b.axis);
      b.el.classList.toggle("on", on);
      b.el.setAttribute("aria-pressed", String(on));
    }
  };
  const toggle = (kind, axis) => {
    const set = kind === "most" ? most : least;
    const other = kind === "most" ? least : most;
    if (set.has(axis)) set.delete(axis);
    else if (set.size < 2) {
      set.add(axis);
      other.delete(axis);
    }
    refresh();
  };
  const finish = (prediction) => {
    app.data.profile.selfPrediction = prediction;
    app.data.profile.firstReportAt = now();
    app.data.profile.reportPending = false;
    persist();
    go("#/report/new"); // 点了"看报告"才整理（要花钱），见 report.js
  };

  const rows = app.content.axes.map((ax) => {
    const mk = (kind) => {
      const el = h("button", { type: "button", class: "toggle", "aria-pressed": "false", onClick: () => toggle(kind, ax.id) }, t(`predict.${kind}`));
      buttons.push({ kind, axis: ax.id, el });
      return el;
    };
    return h("div", { class: "axis-row" }, h("div", {}, h("strong", {}, ax.name), h("p", { class: "muted small" }, ax.plain)), h("div", { class: "toggles" }, mk("most"), mk("least")));
  });

  mount(
    view,
    h("h1", {}, t("predict.title")),
    h("p", {}, t("predict.body")),
    h("div", { class: "axis-list" }, rows),
    h("p", { class: "note" }, t("predict.note")),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: "primary", onClick: () => finish({ most: [...most], least: [...least], at: now() }) }, t("predict.submit")),
      h("button", { type: "button", class: "ghost", onClick: () => finish(null) }, t("predict.skip")),
    ),
  );
}
