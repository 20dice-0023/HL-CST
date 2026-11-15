// "它是怎么运作的"：把 design/ 里的几份说明直接显示在网站里（原来链到 .md 原文件，托管以后只能看到原始文字）。
// 说明里写了题目怎么分类、看什么，打开前先说清楚：看过以后再做的题算"知情后"，单独统计（见 session.js 的 informedAt）。

import { h, mount } from "../dom.js";
import { t } from "../i18n.js";
import { app, persist } from "../app.js";
import { informedAt, now, reportUnlocked } from "../session.js";
import { parseMarkdown } from "../markdown.js";

export const DOCS = ["01-core-principles", "02-axes-v0", "03-output-spec", "04-repo-and-release", "changelog"];

export function renderHow(view, name) {
  const doc = DOCS.includes(name) ? name : DOCS[0];
  // 已经知情的（看过报告，或者之前已经点过"打开看"）不再问。
  if (!informedAt(app.data)) return gate(view, doc);
  load(view, doc);
}

function gate(view, doc) {
  mount(
    view,
    h("h1", {}, t("how.title")),
    h("p", {}, t("how.gate")),
    reportUnlocked(app.data) ? null : h("p", { class: "note" }, t("how.gateEarly")),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onClick: () => {
            app.data.profile.docsReadAt = now();
            persist();
            load(view, doc);
          },
        },
        t("how.open"),
      ),
      h("a", { class: "button ghost", href: "#/" }, t("how.notNow")),
    ),
  );
}

async function load(view, doc) {
  const nav = app.nav;
  mount(view, h("p", { class: "loading", role: "status" }, t("how.loading")));
  let text;
  try {
    const res = await fetch(`design/${doc}.md`);
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch (e) {
    // 说明是点开时才去服务器读的：网断了，或者本地服务器已经关了（页面还开着），都会走到这里。
    // 原来这里给的是"直接打开原文件"的链接，可服务器不在时它也打不开，改成再读一次。
    console.warn(e);
    if (nav === app.nav)
      mount(
        view,
        h("p", { class: "error" }, t("how.failed")),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "primary", onClick: () => load(view, doc) }, t("how.retry")),
          h("a", { class: "button ghost", href: "#/" }, t("nav.home")),
        ),
      );
    return;
  }
  if (nav !== app.nav) return;
  const tabs = h(
    "nav",
    { class: "doc-nav", "aria-label": t("how.title") },
    DOCS.map((d) => (d === doc ? h("strong", { "aria-current": "page" }, t(`how.docs.${d}`)) : h("a", { href: `#/how/${d}` }, t(`how.docs.${d}`)))),
  );
  mount(view, tabs, h("article", { class: "doc" }, renderBlocks(parseMarkdown(text))), h("div", { class: "actions" }, h("a", { class: "button ghost", href: "#/" }, t("nav.home"))));
}

// 链接：几份说明之间互相跳，留在网站里；外面的网址在新窗口打开；别的相对地址按 design/ 算。
// 只放行 http(s)，别的（比如 javascript:）只显示文字。
function linkAttrs(href) {
  const m = href.match(/^(?:\.\/)?([\w.-]+)\.md(?:#.*)?$/);
  if (m && DOCS.includes(m[1])) return { href: `#/how/${m[1]}` };
  if (href.startsWith("#")) return null; // 页内锚点和地址栏的路由冲突，不做成链接
  let url;
  try {
    url = new URL(href, new URL("design/", location.href));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin === location.origin ? { href: url.href } : { href: url.href, target: "_blank", rel: "noopener noreferrer" };
}

function renderInline(spans) {
  return spans.map((s) => {
    switch (s.type) {
      case "strong":
        return h("strong", {}, renderInline(s.children));
      case "em":
        return h("em", {}, renderInline(s.children));
      case "code":
        return h("code", {}, s.text);
      case "link": {
        const attrs = linkAttrs(s.href);
        return attrs ? h("a", attrs, renderInline(s.children)) : renderInline(s.children);
      }
      default:
        return s.text;
    }
  });
}

function renderItem(item) {
  // 紧凑列表：条目只有一段文字时不套段落。
  const [first, ...rest] = item.blocks;
  return first?.type === "paragraph" ? [renderInline(first.inline), renderBlocks(rest)] : renderBlocks(item.blocks);
}

function renderBlocks(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return h(`h${b.level}`, {}, renderInline(b.inline));
      case "paragraph":
        return h("p", {}, renderInline(b.inline));
      case "list":
        return h(b.ordered ? "ol" : "ul", b.ordered && b.start !== 1 ? { start: b.start } : {}, b.items.map((it) => h("li", {}, renderItem(it))));
      case "quote":
        return h("blockquote", {}, renderBlocks(b.blocks));
      case "code":
        return h("pre", {}, h("code", {}, b.text));
      case "table":
        return h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, b.header.map((c) => h("th", {}, renderInline(c))))),
            h("tbody", {}, b.rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, renderInline(c)))))),
          ),
        );
      case "hr":
        return h("hr");
      default:
        return null;
    }
  });
}
