import { download, h, pickFile } from "../dom.js";
import { t } from "../i18n.js";
import { app, persist } from "../app.js";
import { clearAll, clearSettings, emptyData, exportData, forgetSecrets, parseImport } from "../store.js";
import { normalizeSettings } from "../settings.js";

// 导出、导入、删除全部记录（输出规格 1.10）。导出的文件不含 key。
export function dataTools(onChange) {
  const msg = h("p", { class: "hint", role: "status" });
  const exportAll = () => download(`hl-cst-${new Date().toISOString().slice(0, 10)}.json`, exportData(app.data));
  const importFile = async () => {
    const text = await pickFile("application/json,.json");
    if (!text) return;
    let incoming;
    try {
      incoming = parseImport(text);
    } catch {
      msg.replaceChildren(t("report.s10.importFailed"));
      return;
    }
    const apply = () => {
      app.data = incoming;
      persist();
      msg.replaceChildren(t("report.s10.imported"));
      onChange?.();
    };
    // 导入是整个替换，不是合并。这台设备上已经有记录时先问一句，免得把新做的冲掉。
    if (!app.data.sessions.length) return apply();
    msg.replaceChildren(
      h("span", { class: "confirm-q" }, t("report.s10.importConfirm", { have: app.data.sessions.length, incoming: incoming.sessions.length })),
      h("button", { type: "button", class: "danger small", onClick: apply }, t("common.confirm")),
      h("button", { type: "button", class: "ghost small", onClick: () => msg.replaceChildren() }, t("common.cancel")),
    );
  };
  // 删除全部记录时问一句要不要连 key 和服务商设置一起删（安全审查第 5 条）：原来只删记录，key 还留在这台设备上。
  const deleteAll = (alsoKeys) => {
    clearAll();
    app.data = emptyData();
    persist();
    if (alsoKeys) {
      forgetSecrets();
      clearSettings();
      app.secrets = { keys: {} };
      app.settings = normalizeSettings(null);
    }
    onChange?.();
  };
  const deleteWrap = h("span", { class: "confirm" });
  const resetDelete = () => deleteWrap.replaceChildren(deleteButton);
  const askDelete = () => {
    const alsoKeys = h("input", { type: "checkbox" });
    deleteWrap.replaceChildren(
      h("span", { class: "confirm-q" }, t("report.s10.deleteConfirm")),
      h("label", { class: "check" }, alsoKeys, t("report.s10.deleteSecrets")),
      h("button", { type: "button", class: "danger small", onClick: () => { const both = alsoKeys.checked; resetDelete(); deleteAll(both); } }, t("common.confirm")),
      h("button", { type: "button", class: "ghost small", onClick: resetDelete }, t("common.cancel")),
    );
  };
  const deleteButton = h("button", { type: "button", class: "danger-outline", onClick: askDelete }, t("report.s10.delete"));
  deleteWrap.append(deleteButton);
  return h(
    "div",
    { class: "data-tools" },
    h("p", {}, t("report.s10.body")),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: "ghost", onClick: exportAll }, t("report.s10.export")),
      h("button", { type: "button", class: "ghost", onClick: importFile }, t("report.s10.import")),
      deleteWrap,
    ),
    msg,
  );
}
