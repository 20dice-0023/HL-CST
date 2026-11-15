import { h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, confirmButton, errorText, saveSettings, targetLabel } from "../app.js";
import { PROVIDERS, PROVIDER_ORDER, defaultAuditorModel, isCoveredModel, normalizeSettings, resolveTarget } from "../settings.js";
import { callRole, listModels } from "../llm.js";
import { SIZES, THEMES, loadDisplay, saveDisplay } from "../display.js";
import { forgetSecrets } from "../store.js";

// 重画设置页后要显示的一句话（比如"key 已经删掉了"）。
let notice = "";

export function renderSettings(view) {
  const draft = normalizeSettings(structuredClone(app.settings));
  const keys = { ...(app.secrets.keys ?? {}) };
  const models = {}; // 服务商 -> 拉到的模型列表
  const memo = { main: {}, auditor: {} }; // 服务商 -> 这一页里填过的模型和地址，来回切换时不丢
  const savedMsg = h("p", { class: "ok", role: "status" }, notice);
  notice = "";

  const field = (label, control, hint) =>
    h("div", { class: "field" }, h("span", { class: "label" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);

  const providerSelect = (value, onChange) =>
    h(
      "select",
      { "aria-label": t("settings.provider"), onChange: (e) => onChange(e.target.value) },
      PROVIDER_ORDER.map((id) => h("option", { value: id, selected: id === value }, `${t(`settings.providers.${id}`)} · ${t(`settings.badge.${id}`)}`)),
    );

  function retention(pid) {
    const p = PROVIDERS[pid];
    return h(
      "div",
      { class: `retention ${pid}` },
      h("p", { class: "label" }, t("settings.retentionTitle")),
      h(
        "p",
        {},
        t(`settings.retention.${pid}`),
        " ",
        p.retentionUrl ? h("a", { href: p.retentionUrl, target: "_blank", rel: "noopener noreferrer" }, t("settings.retentionLink")) : null,
      ),
    );
  }

  function keyInput(pid) {
    if (!PROVIDERS[pid].needsKey) return null;
    const input = h("input", {
      type: "password",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": t("settings.apiKey"),
      value: keys[pid] ?? "",
      onInput: (e) => {
        keys[pid] = e.target.value.trim();
      },
    });
    return field(t("settings.apiKey"), input, t("settings.apiKeyHint"));
  }

  function baseURLInput(pid, get, set) {
    if (!PROVIDERS[pid].editableBaseURL) return null;
    return [
      field(
        t("settings.baseURL"),
        h("input", { type: "url", spellcheck: "false", "aria-label": t("settings.baseURL"), value: get() || PROVIDERS[pid].baseURL, onInput: (e) => set(e.target.value.trim()) }),
      ),
      // "其它兼容服务"的地址会收到 key 和全部题目、回答；网上有叫人填"免费中转"地址的说法（安全审查第 2 条，修订记录第 18 轮）。
      pid === "custom" ? h("p", { class: "warn" }, t("settings.baseURLWarning")) : null,
    ];
  }

  // 模型输入框：可以直接填，也可以先拉列表再选。输入时只就地更新提示，不重画整页，免得丢焦点。
  function modelInput(listId, pid, get, set, getBaseURL, extra) {
    const datalist = h("datalist", { id: listId }, (models[pid] ?? PROVIDERS[pid].curatedModels ?? []).map((m) => h("option", { value: m })));
    const covered = h("p", { class: "warn", hidden: !isCoveredModel(get()) }, t("settings.covered"));
    const note = h("p", { class: "hint", role: "status" });
    const input = h("input", {
      type: "text",
      list: listId,
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": t("settings.model"),
      placeholder: t("settings.modelPlaceholder"),
      value: get(),
      onInput: (e) => {
        set(e.target.value.trim());
        covered.hidden = !isCoveredModel(e.target.value);
        extra?.(e.target.value.trim());
      },
    });
    const fetchBtn = h(
      "button",
      {
        type: "button",
        class: "ghost small",
        onClick: async () => {
          if (PROVIDERS[pid].needsKey && !keys[pid]) {
            note.textContent = t("settings.needKeyFirst");
            return;
          }
          note.textContent = t("settings.fetchingModels");
          try {
            const ids = await listModels(pid, { apiKey: keys[pid] ?? "", baseURL: getBaseURL() });
            models[pid] = ids;
            datalist.replaceChildren(...ids.map((m) => h("option", { value: m })));
            note.textContent = t("settings.modelsFetched", { n: ids.length });
          } catch (e) {
            // 有的接口遇到不对的 key，返回的错误不带跨域头（Anthropic 的模型列表就是这样），网页只看得到"被拦"，像是连不上。
            note.textContent = e?.kind === "network" ? t("settings.modelsNetworkHint") : errorText(e);
          }
        },
      },
      t("settings.fetchModels"),
    );
    return [field(t("settings.model"), h("div", { class: "row" }, input, fetchBtn)), datalist, note, covered];
  }

  function mainSection() {
    const pid = draft.main.provider;
    return h(
      "section",
      { class: "card" },
      h("h2", {}, t("settings.mainSection")),
      field(
        t("settings.provider"),
        providerSelect(pid, (v) => {
          memo.main[pid] = { model: draft.main.model, baseURL: draft.main.baseURL, auditorModel: draft.auditor.model };
          const m = memo.main[v];
          draft.main.provider = v;
          draft.main.model = m?.model ?? PROVIDERS[v].defaultMain ?? "";
          draft.main.baseURL = m?.baseURL ?? "";
          if (draft.auditor.mode !== "separate") draft.auditor.model = m?.auditorModel ?? defaultAuditorModel(v);
          render();
        }),
      ),
      retention(pid),
      keyInput(pid),
      baseURLInput(pid, () => draft.main.baseURL, (v) => (draft.main.baseURL = v)),
      modelInput("models-main", pid, () => draft.main.model, (v) => (draft.main.model = v), () => draft.main.baseURL || PROVIDERS[pid].baseURL),
      h("p", { class: "hint" }, t(PROVIDERS[pid].defaultMain ? "settings.costNote" : "settings.pickModelNote")),
      pid === "deepseek" ? h("p", { class: "hint" }, t("settings.deepseekUsage")) : null,
    );
  }

  function auditorSection() {
    const separate = draft.auditor.mode === "separate";
    const radio = (mode, label) =>
      h(
        "label",
        { class: "radio" },
        h("input", {
          type: "radio",
          name: "auditor-mode",
          checked: (mode === "separate") === separate,
          onChange: () => {
            draft.auditor.mode = mode;
            render();
          },
        }),
        label,
      );
    const body = [];
    if (!separate) {
      const pid = draft.main.provider;
      const sameModel = (v) => !v || v === draft.main.model;
      const warnSame = h("p", { class: "hint", hidden: !sameModel(draft.auditor.model) }, t("settings.auditorSameModelWarn"));
      body.push(
        ...modelInput("models-auditor", pid, () => draft.auditor.model, (v) => (draft.auditor.model = v), () => draft.main.baseURL || PROVIDERS[pid].baseURL, (v) => {
          warnSame.hidden = !sameModel(v);
        }),
        warnSame,
      );
    } else {
      const pid = draft.auditor.provider;
      body.push(
        field(
          t("settings.provider"),
          providerSelect(pid, (v) => {
            memo.auditor[pid] = { model: draft.auditor.separateModel, baseURL: draft.auditor.baseURL };
            const m = memo.auditor[v];
            draft.auditor.provider = v;
            draft.auditor.separateModel = m?.model ?? PROVIDERS[v].defaultAuditor ?? PROVIDERS[v].defaultMain ?? "";
            draft.auditor.baseURL = m?.baseURL ?? "";
            render();
          }),
        ),
        retention(pid),
        keyInput(pid),
        baseURLInput(pid, () => draft.auditor.baseURL, (v) => (draft.auditor.baseURL = v)),
        ...modelInput("models-auditor-sep", pid, () => draft.auditor.separateModel, (v) => (draft.auditor.separateModel = v), () => draft.auditor.baseURL || PROVIDERS[pid].baseURL),
      );
    }
    return h(
      "section",
      { class: "card" },
      h("h2", {}, t("settings.auditorSection")),
      h("p", { class: "hint" }, t("settings.auditorIntro")),
      h("div", { class: "radios" }, radio("same", t("settings.auditorSame")), radio("separate", t("settings.auditorSeparate"))),
      body,
    );
  }

  function save() {
    app.settings = normalizeSettings(draft);
    app.secrets = { keys: { ...keys } };
    saveSettings();
    savedMsg.textContent = t("settings.saved");
  }

  async function test(out) {
    out.replaceChildren(h("p", { class: "hint" }, t("settings.testing")));
    const ctx = { settings: normalizeSettings(draft), secrets: { keys }, content: app.content, demo: false, demoState: null };
    const lines = [];
    for (const [role, section] of [
      ["ping", "settings.mainSection"],
      ["pingAuditor", "settings.auditorSection"],
    ]) {
      const tg = resolveTarget(ctx.settings, ctx.secrets, role);
      try {
        const res = await callRole(ctx, role, {});
        lines.push(h("p", { class: "ok" }, `${t(section)}：${t("settings.testOk", { who: targetLabel(`${tg.providerId} / ${res.model}`) })}`));
      } catch (e) {
        lines.push(h("p", { class: "error" }, `${t(section)}：${errorText(e)}`));
      }
    }
    out.replaceChildren(...lines);
  }

  // 共用电脑上记住了 key，原来只能清空输入框再保存才去得掉（安全审查第 5 条）。
  function forgetKeys() {
    forgetSecrets();
    app.secrets = { keys: {} };
    notice = t("settings.forgotten");
    renderSettings(view);
  }

  function footer() {
    const testOut = h("div", { class: "test-results", role: "status" });
    return h(
      "section",
      { class: "card" },
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          checked: draft.remember,
          onChange: (e) => {
            draft.remember = e.target.checked;
          },
        }),
        t("settings.remember"),
      ),
      h("p", { class: "hint" }, t("settings.rememberHint")),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "primary", onClick: save }, t("common.save")),
        h("button", { type: "button", class: "ghost", onClick: () => test(testOut) }, t("settings.test")),
        confirmButton(t("settings.forget"), t("settings.forgetConfirm"), forgetKeys, "ghost"),
      ),
      savedMsg,
      testOut,
    );
  }

  // 显示：选了就生效、单独存，和上面要点"保存"的服务商设置分开。
  function displaySection() {
    const current = loadDisplay();
    const group = (name, options, value, onPick) =>
      h(
        "fieldset",
        { class: "plain" },
        h("legend", {}, t(`settings.${name}`)),
        h(
          "div",
          { class: "radios inline" },
          options.map((opt) =>
            h(
              "label",
              { class: "radio" },
              h("input", { type: "radio", name: `display-${name}`, value: opt, checked: value === opt, onChange: () => onPick(opt) }),
              t(`settings.${name}s.${opt}`),
            ),
          ),
        ),
      );
    return h(
      "section",
      { class: "card" },
      h("h2", {}, t("settings.display")),
      h("p", { class: "hint" }, t("settings.displayHint")),
      group("theme", THEMES, current.theme, (theme) => saveDisplay({ ...loadDisplay(), theme })),
      group("size", SIZES, current.size, (size) => saveDisplay({ ...loadDisplay(), size })),
    );
  }

  function render() {
    mount(view, h("h1", {}, t("settings.title")), mainSection(), auditorSection(), footer(), displaySection());
  }

  render();
}
