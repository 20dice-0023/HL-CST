import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, confirmButton, ctxFor, errorText, findSession, persist, retryHint } from "../app.js";
import {
  chosenQuestion,
  ensureCoding1,
  ensureCoding2,
  ensureRound,
  makeProbe,
  mayProbe,
  needsFollowUp,
  PREFETCH_AHEAD,
  nextRoundIndex,
  recordAnswer,
  recordProbe,
  shouldProbe,
} from "../session.js";

export function renderSession(view, id) {
  const session = findSession(id);
  if (!session) return go("#/");
  const index = nextRoundIndex(session);
  if (session.status === "done" || index === null) return go(`#/end/${id}`);

  const nav = app.nav;
  const stale = () => nav !== app.nav;
  const total = session.plan.length;
  const progress = (i) => h("p", { class: "progress" }, t("round.progress", { i, n: total }));
  const ctx = () => ctxFor(session);
  const save = () => {
    persist(); // 存不上时 persist 自己会在页面顶上提示
  };

  // 第一组要从头出题、审题，等得最久；之后的几组多半已经在后台准备好了。等得太久就换一句话，让人知道还在动。
  const waiting = h("p", { class: "loading" }, t(session.rounds.length === 0 ? "round.preparingFirst" : "round.preparing"));
  mount(view, progress(index), waiting);
  const slow = setTimeout(() => {
    if (!stale()) waiting.textContent = t("round.preparingSlow");
  }, 45000);
  ensureRound(ctx(), session, index, save)
    .then((round) => {
      clearTimeout(slow);
      if (stale()) return;
      showRound(round);
      prefetch(index);
    })
    .catch((e) => {
      clearTimeout(slow);
      if (stale()) return;
      mount(
        view,
        progress(index),
        h("p", { class: "error" }, t("round.prepareFailed", { reason: errorText(e) })),
        h("div", { class: "actions" }, h("button", { type: "button", onClick: () => renderSession(view, id) }, t("common.retry")), h("a", { class: "button ghost", href: "#/" }, t("round.pause"))),
        h("p", { class: "small muted" }, retryHint(e)),
      );
    });

  // 受试者作答时，后台先把后面两组的题准备好。按顺序一组一组来：后一组出题时要看到前一组的题，免得重复。
  function prefetch(current) {
    const upcoming = session.plan.filter((p) => p.index > current && !session.rounds.some((r) => r.index === p.index)).slice(0, PREFETCH_AHEAD);
    upcoming
      .reduce((chain, p) => chain.then(() => ensureRound(ctx(), session, p.index, save)), Promise.resolve())
      .catch((e) => console.warn("prefetch failed", e));
  }

  function showRound(round) {
    let selected = null;
    const msg = h("p", { class: "error", role: "alert" });
    const textarea = h("textarea", { rows: 6, "aria-label": t("round.answerPlaceholder"), placeholder: t("round.answerPlaceholder") });
    const answerBox = h("div", { class: "answer", hidden: true }, textarea);
    const cards = round.offered.map((o) =>
      h(
        "button",
        { type: "button", class: "qcard", "aria-pressed": "false", onClick: () => select(o.qid) },
        h("span", { class: "qnum" }, String(o.position)),
        h("span", { class: "qtext" }, o.text),
      ),
    );
    function select(qid) {
      selected = qid;
      cards.forEach((c, i) => {
        const on = round.offered[i].qid === qid;
        c.classList.toggle("selected", on);
        c.setAttribute("aria-pressed", String(on));
      });
      answerBox.hidden = false;
      msg.textContent = "";
      textarea.focus();
    }
    async function submit() {
      if (!selected || !textarea.value.trim()) {
        msg.textContent = t("round.needAnswer");
        return;
      }
      recordAnswer(round, { choice: selected, answer: textarea.value });
      save();
      await afterAnswer(round);
    }
    function skip() {
      recordAnswer(round, { choice: "skip", answer: "" });
      save();
      renderSession(view, id);
    }
    mount(
      view,
      progress(round.index),
      h("p", { class: "muted" }, t("round.instruction")),
      h("div", { class: "cards" }, cards),
      answerBox,
      msg,
      h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onClick: submit }, t("round.submit")), h("button", { type: "button", class: "ghost", onClick: skip }, t("round.skipRound"))),
      h(
        "div",
        { class: "actions secondary" },
        h("a", { class: "button ghost small", href: "#/" }, t("round.pause")),
        confirmButton(t("round.end"), t("round.endConfirm"), () => go(`#/end/${id}`)),
      ),
    );
  }

  async function afterAnswer(round) {
    if (needsFollowUp(round)) await showFollowUp(round);
    if (stale()) return;
    if (round.choice !== "skip") {
      // 编码失败不挡流程：整理报告时会补编。
      const coding = ensureCoding1(ctx(), session, round).then(save);
      if (mayProbe(ctx(), session, round)) {
        // 回答像是暂缓：等编码确认，再决定要不要补全追问。
        mount(view, progress(round.index), h("p", { class: "loading" }, t("round.thinking")));
        await coding.catch((e) => console.warn("coding failed", e));
        if (stale()) return;
        if (shouldProbe(session, round)) {
          let prompt = null;
          try {
            prompt = await makeProbe(ctx(), round);
          } catch (e) {
            console.warn("probe failed", e);
          }
          if (stale()) return;
          if (prompt) await showProbe(round, prompt);
        }
      } else {
        coding.catch((e) => console.warn("coding failed", e));
      }
      // 第二遍编码也趁着答下一组的时候先做掉，整理报告时就不用等。
      ensureCoding2(ctx(), session, round)
        .then(save)
        .catch((e) => console.warn("second coding failed", e));
    }
    if (!stale()) renderSession(view, id);
  }

  function showFollowUp(round) {
    return new Promise((resolve) => {
      const input = h("textarea", { rows: 3, "aria-label": t("round.followUpTitle") });
      const done = (text) => {
        // 记下当时问的原话：措辞以后可能再改，分析时要知道受试者回答的是哪句。
        round.followUp = { prompt: t("round.followUpTitle"), text, declined: !text };
        save();
        resolve();
      };
      mount(
        view,
        progress(round.index),
        h("h2", {}, t("round.followUpTitle")),
        h("p", { class: "muted" }, t("round.followUpHint")),
        input,
        h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onClick: () => done(input.value.trim()) }, t("common.continue")), h("button", { type: "button", class: "ghost", onClick: () => done("") }, t("common.skip"))),
      );
      input.focus();
    });
  }

  function showProbe(round, prompt) {
    return new Promise((resolve) => {
      const input = h("textarea", { rows: 4, "aria-label": t("round.probePlaceholder"), placeholder: t("round.probePlaceholder") });
      const done = (opts) => {
        recordProbe(session, round, { prompt, ...opts });
        save();
        resolve();
      };
      // 补全追问是接着原题问的，把原题放在上面，不用凭记忆。
      const q = chosenQuestion(round);
      mount(
        view,
        progress(round.index),
        q ? h("div", { class: "original" }, h("p", { class: "label" }, t("round.originalQuestion")), h("p", {}, q.text)) : null,
        h("h2", {}, t("round.probeTitle")),
        h("p", { class: "probe" }, prompt),
        input,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "primary", onClick: () => (input.value.trim() ? done({ response: input.value }) : done({ keptDeferring: true })) }, t("round.submit")),
          h("button", { type: "button", class: "ghost", onClick: () => done({ keptDeferring: true }) }, t("round.probeKeepDeferring")),
          h("button", { type: "button", class: "ghost", onClick: () => done({ declined: true }) }, t("round.probeDecline")),
        ),
      );
      input.focus();
    });
  }
}
