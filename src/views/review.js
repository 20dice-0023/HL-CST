import { h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, persist } from "../app.js";
import { annotationKey, collectRounds } from "../analysis.js";
import { followUpPrompt, liveSessions, now } from "../session.js";

// 回看依据（输出规格 1.8）：把一条假设依据的那几组原样调出来，可以逐组写批注。
export function renderReview(view, hid) {
  const hyp = app.data.profile.reports.flatMap((r) => r.hypotheses).findLast((x) => x.id === hid);
  if (!hyp) return mount(view, h("p", {}, t("review.notFound")), h("a", { class: "button", href: "#/report" }, t("common.back")));
  const items = collectRounds(app.data, liveSessions(app.data));
  const numbers = [...new Set(hyp.evidence.map((e) => e.round).filter((n) => n > 0))];
  const blocks = numbers.map((n) => items.find((it) => it.n === n)).filter(Boolean).map(roundBlock);
  mount(
    view,
    h("h1", {}, t("review.title")),
    h("p", { class: "statement" }, hyp.statement),
    blocks.length ? blocks : h("p", { class: "muted" }, t("review.noRounds")),
    h("a", { class: "button ghost", href: "#/report" }, t("common.back")),
  );
}

function roundBlock(it) {
  const key = annotationKey(it.session, it.round);
  const ann = app.data.profile.annotations[key] ?? {};
  const why = h("textarea", { rows: 3, value: ann.why ?? "", "aria-label": t("review.why") });
  const problem = h("input", { type: "checkbox", checked: Boolean(ann.problem) });
  const msg = h("p", { class: "ok", role: "status" });
  const save = () => {
    const prev = app.data.profile.annotations[key] ?? {};
    const problemChanged = Boolean(prev.problem) !== problem.checked;
    app.data.profile.annotations[key] = {
      ...prev,
      why: why.value.trim(),
      problem: problem.checked,
      at: now(),
      recheck: problemChanged ? null : (prev.recheck ?? null),
    };
    if (!problem.checked) it.round.excluded = null;
    persist();
    msg.textContent = t("review.saved");
  };
  const chosen = it.round.choice;
  return h(
    "section",
    { class: "card" },
    h("h2", {}, t("report.card.roundN", { n: it.n })),
    h(
      "ol",
      { class: "offered" },
      it.round.offered.map((o) => h("li", { class: o.qid === chosen ? "chosen" : "" }, o.text, o.qid === chosen ? h("span", { class: "tag" }, t("review.chosen")) : null)),
    ),
    chosen === "skip"
      ? h("p", { class: "muted" }, t("review.skipped"))
      : [
          h("h3", {}, t("review.answer")),
          h("p", {}, it.round.answer),
          it.round.followUp?.text ? h("p", { class: "small" }, `${followUpPrompt(it.round)} ${it.round.followUp.text}`) : null,
          it.round.probes.map((pr) =>
            h("p", { class: "small" }, `${pr.prompt} → ${pr.declined ? t("round.probeDecline") : pr.keptDeferring ? t("round.probeKeepDeferring") : pr.response}`),
          ),
        ],
    h("div", { class: "field" }, h("span", { class: "label" }, t("review.why")), why),
    h("label", { class: "check" }, problem, t("review.problem")),
    h("div", { class: "actions" }, h("button", { type: "button", onClick: save }, t("review.save"))),
    msg,
  );
}
