// 全局状态和几个各页面共用的小工具。

import { saveData, saveSecrets, saveSettingsRaw } from "./store.js";
import { t } from "./i18n.js";
import { h } from "./dom.js";
import { REPORT_AFTER_ROUNDS, REPORT_AFTER_SESSIONS, answeredLiveRounds, completedSessions, earlierQuestions } from "./session.js";

export const app = {
  content: null,
  data: null,
  settings: null,
  secrets: null,
  nav: 0, // 每次换页加一；异步任务回来时用它判断页面是不是已经换了
};

/** 存记录；存不进去（比如浏览器空间满了、浏览器不让存）时返回错误，并在页面顶上留一条提示，下次存上了再撤掉。 */
export function persist() {
  try {
    saveData(app.data);
    showSaveWarning(null);
    return null;
  } catch (e) {
    console.error(e);
    showSaveWarning(e);
    return e;
  }
}

function showSaveWarning(error) {
  const old = document.getElementById("save-warning");
  if (!error) return old?.remove();
  const text = t("common.saveFailed", { reason: error.message });
  if (old) old.textContent = text;
  else document.getElementById("view")?.before(h("p", { id: "save-warning", class: "save-warning", role: "alert" }, text));
}

export function saveSettings() {
  saveSettingsRaw(app.settings);
  saveSecrets(app.secrets, app.settings.remember);
}

/** 模型调用的上下文。试玩不调用任何模型。earlier：以前几轮出过的题，出题时摘给出题模型看。 */
export function ctxFor(session) {
  const used = new Set(session ? session.rounds.flatMap((r) => r.offered.map((o) => o.text)) : []);
  return {
    settings: app.settings,
    secrets: app.secrets,
    content: app.content,
    demo: session?.mode === "demo",
    demoState: { usedExamples: used },
    earlier: session?.mode === "live" ? earlierQuestions(app.data, session) : [],
  };
}

export function errorText(e) {
  if (e?.name === "LLMError") return t(`error.${e.kind}`, { message: e.message, category: e.extra?.category || "—" });
  return t("error.unknown", { message: e?.message ?? String(e) });
}

// 这几种出错时，服务商多半已经处理过请求（超时的可能处理完了，截断、格式不对、拒答的肯定处理了），那一次也会算钱。
const BILLED_ERRORS = new Set(["timeout", "truncated", "bad_output", "refusal"]);

/** 报告还没解锁时的说明：要做满几轮、一共答满几组，现在做到哪了。首页、结束页和报告页共用。 */
export function lockedNote() {
  return t("common.reportLocked", {
    n: REPORT_AFTER_SESSIONS,
    g: REPORT_AFTER_ROUNDS,
    done: completedSessions(app.data),
    answered: answeredLiveRounds(app.data),
  });
}

/** 放在"重试"按钮旁边的一句话：重试是什么意思、要不要钱。 */
export function retryHint(e) {
  return t(e?.name === "LLMError" && BILLED_ERRORS.has(e.kind) ? "common.retryHintBilled" : "common.retryHint");
}

/** 记录里存的是"服务商代号 / 模型"，显示时把代号换成名字："custom / mock-large" → "其它 OpenAI 兼容服务 / mock-large"。 */
export function targetLabel(s) {
  if (!s) return "—";
  const [id, ...rest] = s.split(" / ");
  const key = `settings.providers.${id}`;
  const name = t(key);
  return rest.length && name !== key ? [name, ...rest].join(" / ") : s;
}

/** 联系作者的邮箱。按作者的意思不做成链接，地址照原样显示，想写信的人自己复制。 */
export const contactNote = () => h("section", { class: "contact" }, h("p", {}, t("contact.body")), h("p", { class: "email" }, t("contact.email")));

export const findSession = (id) => app.data.sessions.find((s) => s.id === id) ?? null;
export const activeLiveSession = () => app.data.sessions.find((s) => s.mode === "live" && s.status === "active") ?? null;

/** 先点一次显示"确定 / 取消"，再确认才执行。用来代替浏览器自带的确认弹窗。 */
export function confirmButton(label, question, onConfirm, cls = "ghost small") {
  const wrap = h("span", { class: "confirm" });
  const reset = () => wrap.replaceChildren(button);
  const button = h("button", { type: "button", class: cls, onClick: () => wrap.replaceChildren(
    h("span", { class: "confirm-q" }, question),
    h("button", { type: "button", class: "danger small", onClick: () => { reset(); onConfirm(); } }, t("common.confirm")),
    h("button", { type: "button", class: "ghost small", onClick: reset }, t("common.cancel")),
  ) }, label);
  wrap.append(button);
  return wrap;
}
