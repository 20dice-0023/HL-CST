import { download, h, pickFile } from "../dom.js";
import { t } from "../i18n.js";
import { app, confirmButton, persist } from "../app.js";
import { clearAll, emptyData, exportData, parseImport } from "../store.js";

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
  const deleteAll = () => {
    clearAll();
    app.data = emptyData();
    persist();
    onChange?.();
  };
  return h(
    "div",
    { class: "data-tools" },
    h("p", {}, t("report.s10.body")),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: "ghost", onClick: exportAll }, t("report.s10.export")),
      h("button", { type: "button", class: "ghost", onClick: importFile }, t("report.s10.import")),
      confirmButton(t("report.s10.delete"), t("report.s10.deleteConfirm"), deleteAll, "danger-outline"),
    ),
    msg,
  );
}
