// 读取 content/<语言>/ 下的轴表、包装、词表、界面文案和提示词。

import { splitPrompt } from "./text.js";

const PROMPTS = ["writer", "auditor-questions", "coder", "probe", "analyst", "auditor-hypotheses", "auditor-recheck", "ping"];

const CN_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/**
 * 类别（轴）在界面上的叫法。masked：试玩报告里不写名字，只写"第一类""第二类"……
 * 免得试玩时就知道了题目背后怎么分类，影响以后正式做题。
 */
export function axisLabel(content, id, { masked = false } = {}) {
  if (!masked) return content.axisById[id]?.name ?? id;
  const i = content.axisIds.indexOf(id);
  return i < 0 ? id : `第${CN_NUMBERS[i] ?? i + 1}类`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.text();
}

export async function loadContent(locale = "zh") {
  const base = `content/${locale}/`;
  const [axesFile, packages, wordlists, ui, ...promptTexts] = await Promise.all([
    getJSON(`${base}axes.json`),
    getJSON(`${base}packages.json`),
    getJSON(`${base}wordlists.json`),
    getJSON(`${base}ui.json`),
    ...PROMPTS.map((p) => getText(`${base}prompts/${p}.md`)),
  ]);
  const prompts = Object.fromEntries(PROMPTS.map((p, i) => [p, splitPrompt(promptTexts[i])]));
  const axes = axesFile.axes;
  return {
    locale,
    axisTableVersion: axesFile.version,
    axes,
    axisIds: axes.map((a) => a.id),
    axisById: Object.fromEntries(axes.map((a) => [a.id, a])),
    packages,
    wordlists,
    ui,
    prompts,
  };
}
