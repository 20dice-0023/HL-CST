import test from "node:test";
import assert from "node:assert/strict";
import { chineseQuotes, extractJSON, fill, splitPrompt, visibleLength } from "../src/text.js";

test("extractJSON handles plain, fenced and wrapped output", () => {
  assert.deepEqual(extractJSON('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJSON('```json\n{"a": 2}\n```'), { a: 2 });
  assert.deepEqual(extractJSON('好的，结果如下：{"a": 3} 以上。'), { a: 3 });
  assert.throws(() => extractJSON("没有 JSON"));
  assert.throws(() => extractJSON(""));
});

test("fill replaces placeholders and blanks missing ones", () => {
  assert.equal(fill("轴：{{axis}}，缺：{{none}}", { axis: "A1" }), "轴：A1，缺：");
});

test("splitPrompt needs exactly one ===USER=== line", () => {
  const p = splitPrompt("系统\n\n===USER===\n用户 {{x}}");
  assert.equal(p.system, "系统");
  assert.equal(p.user, "用户 {{x}}");
  assert.throws(() => splitPrompt("没有分隔"));
});

test("visibleLength ignores spaces and punctuation", () => {
  assert.equal(visibleLength("你好，世界！ ab 12"), 8);
});

test("English double quotes in questions become Chinese ones, opening and closing in turn", () => {
  assert.equal(chineseQuotes('同学说"就记两小时吧"，又补了一句"拜托"。'), "同学说“就记两小时吧”，又补了一句“拜托”。");
  assert.equal(chineseQuotes("已经是“中文”的不动"), "已经是“中文”的不动");
});
