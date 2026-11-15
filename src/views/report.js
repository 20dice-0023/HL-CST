import { go, h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, contactNote, ctxFor, errorText, findSession, lockedNote, persist, retryHint, targetLabel } from "../app.js";
import { buildReport } from "../analysis.js";
import { axisLabel } from "../content.js";
import { answeredLiveRounds, liveSessions, now, reportUnlocked } from "../session.js";
import { dataTools } from "./data-tools.js";
import { REASONING_DIMS, REASONING_NONE } from "../reasoning.js";

const pct = (x) => `${Math.round(100 * x)}%`;

export function renderReport(view, kind, id) {
  if (kind === "demo") {
    const s = findSession(id);
    if (!s) return go("#/");
    // 试玩报告由规则拼出来、不花钱。0.4.0 以前拼的写了类别的名字，打开时重新拼一份。
    return s.report?.masked ? show(view, s.report, s) : build(view, s);
  }
  if (!reportUnlocked(app.data)) {
    return mount(view, h("h1", {}, t("report.title")), h("p", {}, lockedNote()), h("a", { class: "button", href: "#/" }, t("nav.home")));
  }
  if (!app.data.profile.firstReportAt) return go("#/predict");
  // 整理报告要用受试者的 key 调用模型、花钱，所以只在受试者自己点了的时候整理：
  // 看报告前的猜测做完（#/report/new）、点"重新整理"。平时打开只给看最近的一份，有新答的组就问一句。
  const latest = app.data.profile.reports.at(-1);
  if (kind === "new" && (!latest || latest.roundsUsed !== answeredLiveRounds(app.data))) return build(view, null);
  if (!latest) return askToBuild(view);
  show(view, latest, null);
}

/** 还没有报告（比如删掉了用到它的那一轮）：先问，点了再整理。 */
function askToBuild(view) {
  mount(
    view,
    h("h1", {}, t("report.title")),
    h("p", {}, t("report.none")),
    h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onClick: () => build(view, null) }, t("report.build"))),
    h("p", { class: "small muted" }, t("report.costNote")),
  );
}

function build(view, demoSession) {
  const nav = app.nav;
  const status = h("p", { class: "loading", role: "status" }, t("analysis.start"));
  mount(view, h("h1", {}, t("analysis.title")), status);
  const ctx = ctxFor(demoSession);
  buildReport(ctx, app.data, { demoSession, onProgress: (key, vars) => (status.textContent = t(key, vars)) })
    .then((report) => {
      persist();
      if (nav !== app.nav) return;
      // 地址栏换回 #/report（不触发换页）：刷新页面时不会再整理一次。
      if (!demoSession && location.hash.startsWith("#/report/new")) history.replaceState(null, "", "#/report");
      show(view, report, demoSession);
    })
    .catch((e) => {
      persist(); // 已经做完的复查和编码先存下来
      if (nav !== app.nav) return;
      mount(
        view,
        h("h1", {}, t("analysis.title")),
        h("p", { class: "error" }, t("analysis.failed", { reason: errorText(e) })),
        h("button", { type: "button", onClick: () => build(view, demoSession) }, t("common.retry")),
        h("p", { class: "small muted" }, retryHint(e)),
      );
    });
}

function show(view, report, demoSession) {
  const { content } = app;
  const live = !demoSession;
  // 试玩报告不写类别的名字和说明，只写"第一类""第二类"……（见 content.js 的 axisLabel）。
  const axisName = (aid) => axisLabel(content, aid, { masked: !live });
  const names = (ids, emptyKey = "report.s6.empty") => (ids?.length ? ids.map(axisName).join("、") : t(emptyKey));
  const roundLabel = (n) => (n > 0 ? t("report.card.roundN", { n }) : t("report.card.round0"));
  const p = (text, cls) => h("p", cls ? { class: cls } : {}, text);
  const section = (titleKey, ...body) => h("section", { class: "card report-section" }, h("h2", {}, t(titleKey)), ...body);

  // 1.1 概况。结束时留的话只放一句摘要，原话和那几组的题放在单独一页，点链接看。
  const o = report.overview;
  const withNotes = o.experiences.filter((ex) => ex.repeatRounds.length || ex.pressure);
  // 旧报告没存 session id：按第几轮找回来（试玩报告就是试玩那一轮）。
  const notesId = (ex) => ex.sessionId ?? (demoSession ? demoSession.id : liveSessions(app.data).find((s) => (s.number || 1) === ex.session)?.id);
  const noteSummary = (ex) =>
    [ex.repeatRounds.length ? t("report.s1.noteRepeat", { k: ex.repeatRounds.length }) : null, ex.pressure ? t("report.s1.notePressure") : null]
      .filter(Boolean)
      .join("；");
  const s1 = section(
    "report.s1.title",
    p(t("report.s1.rounds", { rounds: o.rounds, skips: o.skips, followups: o.followUps, probes: o.probes })),
    o.informed ? p(t("report.s1.informed", { n: o.informed })) : null,
    o.shortAnswers ? p(t("report.s1.short"), "note") : null,
    o.readAxes ? p(t("report.s1.readAxes"), "note") : null,
    withNotes.length
      ? [
          p(t("report.s1.experience")),
          h(
            "ul",
            {},
            withNotes.map((ex) => {
              const id = notesId(ex);
              const who = demoSession ? t("report.s1.demoSession") : t("report.s1.sessionN", { n: ex.session });
              return h("li", {}, `${who}：${noteSummary(ex)}`, id ? [" ", h("a", { href: `#/notes/${id}` }, t("report.s1.noteLink"))] : null);
            }),
          ),
        ]
      : null,
  );

  // 1.2 选择图谱
  const cm = report.choiceMap;
  const judgmentCell = (r) => {
    const label = t(`report.judgment.${r.judgment.key}`) + (r.judgment.confidence ? `（${t("report.confidence", { c: r.judgment.confidence })}）` : "");
    const chance = r.judgment.key.startsWith("avoid") ? r.chanceAvoid : r.judgment.key.startsWith("prefer") ? r.chancePrefer : null;
    return h(
      "td",
      { class: "judgment-cell", "data-label": t("report.s2.judgment") },
      h("span", { class: `judgment ${r.judgment.key}` }, label),
      chance !== null ? h("span", { class: "small muted block" }, t("report.s2.chance", { p: pct(chance) })) : null,
    );
  };
  const axisTable = cm.rows.length
    ? h(
        "table",
        { class: "axis-table" },
        h("thead", {}, h("tr", {}, ["axis", "exposures", "chosen", "expected", "judgment"].map((k) => h("th", {}, t(`report.s2.${k}`))))),
        h(
          "tbody",
          {},
          cm.rows.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, h("strong", {}, axisName(r.axis)), live ? h("span", { class: "small muted block" }, content.axisById[r.axis]?.plain ?? "") : null),
              // 列名也写在格子上：窄屏上表头收起来，一类一块，靠它当标签（见 styles.css）。
              h("td", { "data-label": t("report.s2.exposures") }, String(r.exposures)),
              h("td", { "data-label": t("report.s2.chosen") }, String(r.chosen)),
              h("td", { "data-label": t("report.s2.expected") }, r.expected.toFixed(1)),
              judgmentCell(r),
            ),
          ),
        ),
      )
    : p(t("report.judgment.insufficient"));
  const noJudgment = cm.rows.length > 0 && cm.rows.every((r) => r.judgment.key === "insufficient" || r.judgment.key === "neutral");
  const s2 = section(
    "report.s2.title",
    p(t("report.s2.caption"), "small muted"),
    axisTable,
    cm.rows.length ? p(t("report.s2.expectedNote"), "small muted") : null,
    noJudgment ? p(t("report.s2.early"), "note") : null,
    p(t("report.s2.position", { p1: cm.position[1], p2: cm.position[2], p3: cm.position[3] }), "small"),
    Object.entries(cm.carriers).map(([a, list]) => p(t("report.s2.carriers", { axis: axisName(a), list: list.join("、") }), "small")),
    cm.informedRows.length
      ? [
          h("h3", {}, t("report.s2.informedTitle")),
          h(
            "table",
            { class: "axis-table compact" },
            h("thead", {}, h("tr", {}, ["axis", "exposures", "chosen"].map((k) => h("th", {}, t(`report.s2.${k}`))))),
            h(
              "tbody",
              {},
              cm.informedRows.map((r) =>
                h("tr", {}, h("td", {}, axisName(r.axis)), h("td", { "data-label": t("report.s2.exposures") }, String(r.exposures)), h("td", { "data-label": t("report.s2.chosen") }, String(r.chosen))),
              ),
            ),
          ),
        ]
      : null,
    p(t("report.s2.why"), "small muted"),
  );

  // 没有内容的部分整段不显示，不写"这次没有……"之类的占位话。

  // 1.3 常用的尺子：只列在两组以上反复出现的，最多 5 条；放在报告靠后的位置。
  const recurring = report.criteria.filter((c) => c.rounds.length >= 2);
  const shown = recurring.slice(0, 5);
  const s3 = shown.length
    ? section(
        "report.s3.title",
        h(
          "ul",
          { class: "criteria" },
          shown.map((c) =>
            h(
              "li",
              {},
              h("strong", {}, c.label),
              c.dominant ? h("span", { class: "tag" }, t("report.s3.dominant", { n: c.axes.length })) : null,
              h("span", { class: "small muted block" }, t("report.s3.rounds", { rounds: c.rounds.join("、") })),
              c.quotes.length ? h("blockquote", {}, c.quotes.map((q) => h("p", {}, `「${q}」`))) : null,
            ),
          ),
        ),
        report.criteria.length > shown.length ? p(t("report.s3.more", { n: report.criteria.length - shown.length }), "small muted") : null,
        report.sessionsUsed < 2 ? p(t("report.s3.note"), "note") : null,
      )
    : null;

  // 你凭什么选（修订记录第 11 轮）：推理方式的次数，和同一类取舍里做法、理由各自稳不稳。
  // 只描述说法，不分高低；没有够数的内容就整段不显示。
  const rsn = report.reasoning;
  const R = (k, vars) => t(`report.reasoning.${k}`, vars);
  const valueLabel = (v) => R(`values.${v}`);
  const dimLines = rsn
    ? Object.entries(rsn.dims)
        .filter(([, d]) => d.show)
        .map(([dim, d]) => {
          if (dim === "likelihood") return p(R("likelihoodLine", { n: d.counts.mentioned, total: d.counts.mentioned + d.counts.not_mentioned }));
          const parts =
            dim === "certainty"
              ? [R("part", { label: valueLabel("sure"), n: d.counts.sure }), R("part", { label: R("hedgedOrUnsure"), n: d.counts.hedged + d.counts.unsure })]
              : REASONING_DIMS[dim].map((v) => R("part", { label: valueLabel(v), n: d.counts[v] }));
          const none = d.counts[REASONING_NONE[dim]];
          return p(R("countLine", { dim: R(`dims.${dim}`), parts: parts.join(" · ") }) + (none ? R("noneNote", { n: none }) : ""));
        })
    : [];
  const leanLabel = (axis, v) => {
    const ax = content.axisById[axis];
    // 两头的名字也会透露这一类是什么，试玩报告里不写。
    if (!live && (v === "left" || v === "right")) return R(`leans.${v}Masked`);
    return v === "left" ? ax?.left : v === "right" ? ax?.right : R(`leans.${v}`);
  };
  const stabilityLines = (rsn?.stability ?? [])
    .filter((s) => s.action.status !== "unclear" || s.reason.status !== "unclear")
    .map((s) => {
      const action = s.action.status === "stable" ? R("actionStable", { value: leanLabel(s.axis, s.action.value) }) : R(s.action.status === "varies" ? "actionVaries" : "unclear");
      const reason =
        s.reason.status === "stable"
          ? R("reasonStable", { values: s.reason.dims.map((x) => valueLabel(x.value)).join("、") })
          : R(s.reason.status === "varies" ? "reasonVaries" : "reasonUnclear");
      return h("li", {}, R("stabilityRow", { axis: axisName(s.axis), n: s.rounds, action, reason }));
    });
  const sReason =
    dimLines.length || stabilityLines.length
      ? section(
          "report.reasoning.title",
          p(R("intro"), "small muted"),
          dimLines,
          stabilityLines.length ? [h("h3", {}, R("stabilityTitle")), h("ul", { class: "stability" }, stabilityLines), p(R("legend"), "small muted")] : null,
        )
      : null;

  // 1.4 暂缓的方式
  const d = report.deferral;
  const s4 = d.total
    ? section(
        "report.s4.title",
        p(t("report.s4.counts", { total: d.total, cond: d.conditional, open: d.open })),
        p(t("report.s4.byAxis", { list: d.byAxis.map(([a, n]) => `${axisName(a)} ${n}`).join("、") })),
        d.probeRounds.length ? p(t("report.s4.probes", { decided: d.probes.decided, new_gap: d.probes.new_gap, still: d.probes.still, declined: d.probes.declined })) : null,
        p(t("report.s4.note"), "small muted"),
      )
    : null;

  // 1.5 假设
  const card = (hyp) => {
    const views = ["like", "unlike", "unsure"];
    const fb = app.data.profile.feedback[hyp.id] ?? {};
    const btns = views.map((v) =>
      h(
        "button",
        {
          type: "button",
          class: `toggle${fb.view === v ? " on" : ""}`,
          "aria-pressed": String(fb.view === v),
          onClick: () => {
            fb.view = v;
            fb.at = now();
            app.data.profile.feedback[hyp.id] = fb;
            persist();
            btns.forEach((b, i) => {
              b.classList.toggle("on", views[i] === v);
              b.setAttribute("aria-pressed", String(views[i] === v));
            });
          },
        },
        t(`report.card.${v}`),
      ),
    );
    const comment = h("input", {
      type: "text",
      value: fb.comment ?? "",
      placeholder: t("report.card.comment"),
      "aria-label": t("report.card.comment"),
      onChange: (e) => {
        fb.comment = e.target.value.trim();
        app.data.profile.feedback[hyp.id] = fb;
        persist();
      },
    });
    return h(
      "article",
      { class: "hypothesis" },
      h("p", { class: "statement" }, hyp.statement, hyp.rewritten ? h("span", { class: "tag" }, t("report.card.rewritten")) : null),
      h(
        "dl",
        {},
        h("dt", {}, t("report.card.evidence")),
        h("dd", {}, h("ul", {}, hyp.evidence.map((e) => h("li", {}, `${roundLabel(e.round)}（${e.channel}）：${e.note}`)))),
        h("dt", {}, t("report.card.counter")),
        h("dd", {}, hyp.counter.join("；")),
        h("dt", {}, t("report.card.alternatives")),
        h("dd", {}, hyp.alternatives.join("；")),
        h("dt", {}, t("report.card.confidence")),
        h("dd", {}, `${hyp.confidence}${hyp.confidenceReason ? `：${hyp.confidenceReason}` : ""}`),
        h("dt", {}, t("report.card.prediction")),
        h("dd", {}, hyp.prediction),
      ),
      live
        ? h("div", { class: "feedback" }, h("span", { class: "label" }, t("report.card.yourView")), btns, comment, h("a", { class: "small", href: `#/review/${hyp.id}` }, t("report.card.review")))
        : null,
    );
  };
  const s5 = section("report.s5.title", report.hypotheses.length ? report.hypotheses.map(card) : p(t("report.s5.none")));

  // 1.6 自我预测对照：只在有东西可对照时出现（猜过，而且选择图谱里有下了判断的类别）。
  const sp = report.selfPrediction;
  const s6 =
    live && sp && (sp.actual.most.length || sp.actual.least.length)
      ? section(
          "report.s6.title",
          p(t("report.s6.youThought", { most: names(sp.thought.most), least: names(sp.thought.least) })),
          p(t("report.s6.actual", { most: names(sp.actual.most, "report.s6.actualEmpty"), least: names(sp.actual.least, "report.s6.actualEmpty") })),
        )
      : null;

  // 1.7 预测检验：组数够了才出现。
  const pt = report.predictionTest;
  const s7 =
    pt && pt.n
      ? section(
          "report.s7.title",
          p(t("report.s7.body", { hits: pt.hits, n: pt.n, rate: pct(pt.hits / pt.n), posRate: pct(pt.posHits / pt.n) })),
          pt.hits <= pt.posHits + 1 ? p(t("report.s7.weak"), "note") : null,
        )
      : null;

  // 1.8 你的看法和下一步：上一版假设的预测核对，和你的看法放在一起。
  const priorHypothesis = (hid) => app.data.profile.reports.flatMap((r) => r.hypotheses).find((x) => x.id === hid);
  const classify = (v, status) => {
    if (status === "还没有相关数据") return "pending";
    const hit = status === "准";
    if (v === "like") return hit ? "likeHit" : "likeMiss";
    if (v === "unlike") return hit ? "unlikeHit" : "unlikeMiss";
    return null;
  };
  const priorItems = live
    ? report.priorChecks
        .map((pc) => {
          const prev = priorHypothesis(pc.id);
          if (!prev) return null;
          const v = app.data.profile.feedback[pc.id]?.view;
          const cls = classify(v, pc.status);
          return h(
            "li",
            {},
            t("report.s8.prior", { statement: prev.statement, status: pc.status, view: v ? t(`report.card.${v}`) : t("report.s8.noView") }),
            cls ? h("span", { class: "small muted block" }, t(`report.s8.${cls}`)) : null,
          );
        })
        .filter(Boolean)
    : [];
  // 上一版假设的核对只在有上一版时出现；只有"下次可以留意的时刻"时就只放它。
  const s8 =
    priorItems.length || report.moments.length
      ? section(
          "report.s8.title",
          priorItems.length
            ? [
                p(t("report.s8.intro")),
                h("ul", { class: "small" }, ["likeHit", "likeMiss", "unlikeHit", "unlikeMiss"].map((k) => h("li", {}, t(`report.s8.${k}`)))),
                h("ul", {}, priorItems),
              ]
            : null,
          // 默认收起：看了可能会影响下次的选择，想看的人自己点开。
          report.moments.length
            ? h("details", { class: "moments" }, h("summary", {}, t("report.s8.moments")), h("ul", {}, report.moments.map((m) => h("li", {}, m))))
            : null,
        )
      : null;

  // 1.9 披露
  const dsc = report.disclosure;
  const problemLabel = (code) => {
    const key = `report.problems.${code}`;
    const label = t(key);
    return label === key ? code : label;
  };
  const auditCell = (r) =>
    r.excluded
      ? t("report.s9.excluded", { reason: r.excluded })
      : r.offered.map((q) =>
          h(
            "span",
            { class: "block small" },
            q.verdict === "pass"
              ? // 通过了但另记了只记录、不退回的问题（比如句式雷同）时，也写出来。
                (q.attempts > 1 ? t("report.s9.regenerated", { n: q.attempts - 1 }) : t("report.s9.ok")) +
                  (q.problems?.length ? t("report.s9.noted", { problems: q.problems.map(problemLabel).join("、") }) : "")
              : t("report.s9.flagged", { problems: q.problems.map(problemLabel).join("、") }),
          ),
        );
  // 0.4.0 起出题、审题按每轮记的列出全部，写报告、核对假设按实际调用的；更早的报告每项只有一个。
  const modelList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(targetLabel).join("、") || "—";
  const s9 = section(
    "report.s9.title",
    p(t("report.s9.intro"), "small muted"),
    p(t("report.s9.observed")),
    p(t("report.s9.models", { writer: modelList(dsc.models.writer), auditor: modelList(dsc.models.auditor), analyst: modelList(dsc.models.analyst) })),
    dsc.models.checker ? p(t("report.s9.checker", { model: targetLabel(dsc.models.checker) })) : null,
    live && dsc.sameProvider ? p(t("report.s9.sameProvider"), "note") : null,
    dsc.lifeStages?.length ? p(t("report.s9.stage", { list: dsc.lifeStages.map((id) => t(`consent.stages.${id}`)).join("、") })) : null,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "disclosure" },
        h("thead", {}, h("tr", {}, ["round", "offered", "choice", "audit"].map((k) => h("th", {}, t(`report.s9.${k}`))))),
        h(
          "tbody",
          {},
          dsc.rounds.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, `${r.n}${r.informed ? "*" : ""}`),
              h("td", {}, r.offered.map((q) => h("span", { class: "block small" }, `${axisName(q.axis)}｜${q.carrier}｜${q.position}`))),
              h("td", {}, r.chosen ? axisName(r.chosen) : t("report.s9.skip")),
              h("td", {}, auditCell(r)),
            ),
          ),
        ),
      ),
    ),
    dsc.probeRounds.length ? p(t("report.s9.probes", { rounds: dsc.probeRounds.join("、") }), "small") : null,
    p(t("report.s9.gaps"), "small"),
    p(t("report.s9.hypAudit", { n: dsc.auditLog.rewritten + dsc.auditLog.dropped }), "small"),
    p(t("report.s9.limits"), "small muted"),
  );

  // 1.10 数据
  const s10 = live ? section("report.s10.title", dataTools(() => go("#/"))) : null;

  // 这份报告之后又答了几组：只提一句，要不要重新整理由受试者定（整理要花钱）。
  const fresh = live ? answeredLiveRounds(app.data) - report.roundsUsed : 0;
  const staleNote =
    fresh > 0
      ? h(
          "div",
          { class: "note stale" },
          h("p", {}, t("report.stale", { n: fresh })),
          h("div", { class: "actions" }, h("button", { type: "button", class: "primary small", onClick: () => build(view, null) }, t("report.rebuild"))),
          h("p", { class: "small muted" }, t("report.costNote")),
        )
      : null;

  mount(
    view,
    h("h1", {}, t("report.title")),
    p(t("report.meta", { time: new Date(report.generatedAt).toLocaleString("zh-CN"), sessions: report.sessionsUsed, rounds: report.roundsUsed }), "muted small"),
    demoSession ? p(t("report.demoBanner"), "note") : null,
    staleNote,
    live && !staleNote ? h("div", { class: "actions" }, h("button", { type: "button", class: "ghost small", onClick: () => build(view, null) }, t("report.regenerate"))) : null,
    s1,
    s2,
    sReason,
    s4,
    s5,
    s6,
    s7,
    s8,
    s3,
    s9,
    s10,
    contactNote(),
  );
}
