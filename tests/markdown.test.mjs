// 网站里显示说明文档用的小解析器：设计稿里用到的写法都要认得（修订记录第 14 轮）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMarkdown } from "../src/markdown.js";
import { DOCS } from "../src/views/how.js";

const text = (spans) => spans.map((s) => s.text ?? text(s.children)).join("");

test("headings, paragraphs, nested lists, numbered lists, quotes, tables and code blocks", () => {
  const md = [
    "# 标题",
    "",
    "第一段第一行",
    "接着第二行。",
    "",
    "- 条目一",
    "  - 嵌套甲",
    "  - 嵌套乙",
    "- 条目二 **加粗** 和 `代码` 和 [链接](02-axes-v0.md)",
    "",
    "3. 第三",
    "4. 第四",
    "",
    "> 引用",
    "",
    "| 列1 | 列2 |",
    "|---|---|",
    String.raw`| a | b \| c |`,
    "",
    "```",
    "P(选第 i 题) = exp(β)",
    "```",
  ].join("\n");
  const [h1, para, list, ol, quote, table, code] = parseMarkdown(md);
  assert.deepEqual([h1.type, h1.level, text(h1.inline)], ["heading", 1, "标题"]);
  assert.equal(text(para.inline), "第一段第一行接着第二行。", "Chinese lines are joined without a space");
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].blocks[1].type, "list");
  assert.equal(list.items[0].blocks[1].items.length, 2);
  const spans = list.items[1].blocks[0].inline;
  assert.deepEqual(spans.map((s) => s.type), ["text", "strong", "text", "code", "text", "link"]);
  assert.equal(spans[5].href, "02-axes-v0.md");
  assert.deepEqual([ol.ordered, ol.start, ol.items.length], [true, 3, 2]);
  assert.equal(quote.type, "quote");
  assert.deepEqual(table.rows[0].map(text), ["a", "b | c"]);
  assert.deepEqual([code.type, code.text], ["code", "P(选第 i 题) = exp(β)"]);
});

test("every design document parses, and no table or heading is lost", () => {
  for (const doc of DOCS) {
    const source = readFileSync(new URL(`../design/${doc}.md`, import.meta.url), "utf8");
    const blocks = parseMarkdown(source);
    const walk = (bs) => bs.flatMap((b) => [b, ...(b.blocks ? walk(b.blocks) : []), ...(b.items ? b.items.flatMap((it) => walk(it.blocks)) : [])]);
    const all = walk(blocks);
    const outsideCode = source.replace(/^```[\s\S]*?^```/gm, ""); // 代码块里的 # 不是标题（01 里有一段 README 示例）
    const headings = (outsideCode.match(/^#{1,6} /gm) ?? []).length;
    const tables = (outsideCode.match(/^[ \t]*\|.*\n[ \t]*\|[ \t]*:?-{3,}/gm) ?? []).length; // 列表条目里缩进的表格也算
    assert.equal(all.filter((b) => b.type === "heading").length, headings, `${doc}: headings`);
    assert.equal(all.filter((b) => b.type === "table").length, tables, `${doc}: tables`);
    // 没有把 Markdown 记号当成文字漏出来
    const leaked = all.filter((b) => b.inline && /\*\*|\]\(/.test(text(b.inline)));
    assert.deepEqual(leaked.map((b) => text(b.inline).slice(0, 30)), [], `${doc}: unparsed markup`);
  }
});
