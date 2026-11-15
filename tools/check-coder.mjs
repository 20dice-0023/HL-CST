// 离线检查编码准不准（修订记录第 17 轮，轴表第 9 节第 7 条）。
// 拿 content/zh/standard.json 里每道标准题的样例回答，让编码模型分别在"附拆解""不附拆解"两种情况下编码，
// 再和写好的"应该编成什么"对照。走的是网页里同一套编码流程：同样的提示词、格式检查和重试。
// 不经过浏览器，也不碰你在网页里的记录；结果写进 sim-output/（不进仓库）。
//
// 用法：
//   DeepSeek：node tools/check-coder.mjs --provider deepseek
//   Claude：node tools/check-coder.mjs --provider anthropic --model claude-sonnet-5-5
//   只测流程、不花钱：先运行 node tools/mock-llm-server.mjs，再运行 node tools/check-coder.mjs --provider mock
// 其它参数：
//   --model 名字          换模型（默认 DeepSeek 用 deepseek-flash，Claude 用 claude-haiku-5-5）
//   --card both|on|off    附不附拆解（默认 both：两种都跑，好对比）
//   --only S-A1-1,S-A5-1  只跑这几道
// 运行后会让你粘贴 key：屏幕上不显示，只留在这次运行的内存里，不写进任何文件。
// 也可以事先设好环境变量 DEEPSEEK_API_KEY / ANTHROPIC_API_KEY，就不问了。
// 全跑是 8 道 × 5 份 × 2 种 = 80 次编码调用；编码按网页里的设置走（DeepSeek 不开思考，Claude 的 effort 是 medium）。

import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setUI, t } from "../src/i18n.js";
import { normalizeSettings } from "../src/settings.js";
import { codeRound } from "../src/session.js";
import { setUsageListener } from "../src/llm.js";
import { SCORE_KEYS, scoreCoding, tally } from "../src/standard.js";
import { ROOT, askHidden, loadContentFromDisk, stamp } from "./lib.mjs";

// ---------- 参数 ----------

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const SETUPS = {
  deepseek: { id: "deepseek", model: "deepseek-flash", keyName: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  anthropic: { id: "anthropic", model: "claude-haiku-5-5", keyName: "ANTHROPIC_API_KEY", label: "Claude" },
  mock: { id: "custom", model: "mock-large", key: "mock", baseURL: "http://localhost:8787/v1", label: "模拟服务" },
};
const PROVIDER = arg("provider", "deepseek");
const SETUP = SETUPS[PROVIDER] ?? fail(`不认识的 --provider：${PROVIDER}（可以用 deepseek、anthropic、mock）`);
const MODEL = arg("model", SETUP.model);
const MODES = { both: [true, false], on: [true], off: [false] }[arg("card", "both")] ?? fail("--card 只能是 both、on 或 off");
const ONLY = arg("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------- 内容 ----------

const content = loadContentFromDisk({ standard: true });
setUI(content.ui);
const questions = content.standard.questions.filter((q) => !ONLY.length || ONLY.includes(q.id));
if (!questions.length) fail(`--only 里的编号一个也没找到。现有的：${content.standard.questions.map((q) => q.id).join("、")}`);

const jobs = MODES.flatMap((withCard) => questions.flatMap((q) => q.samples.map((sample) => ({ q, sample, withCard }))));

// ---------- key ----------

async function getKey() {
  const key = SETUP.key ?? process.env[SETUP.keyName];
  if (key) return key;
  if (!process.stdin.isTTY) fail(`没有 key：请在终端里直接运行（会让你粘贴 key），或者先设好环境变量 ${SETUP.keyName}。`);
  const pasted = await askHidden(`粘贴你的 ${SETUP.label} key（右键或 Ctrl+V；屏幕上不显示，用完不保存），然后按回车：`);
  return pasted || fail("没收到 key，退出。");
}

// ---------- 用量 ----------

const usage = { calls: 0, input: 0, output: 0 };
setUsageListener(({ usage: u }) => {
  usage.calls++;
  usage.input += u?.input_tokens ?? u?.prompt_tokens ?? 0;
  usage.output += u?.output_tokens ?? u?.completion_tokens ?? 0;
});
// 每百万 token 的美元价（Anthropic 官方价，输出里含思考）。DeepSeek 的价按时段变，只报 token 数。
const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-fable-5-2": [8, 40],
};

// ---------- 编码 ----------

function codeOne(ctx, { q, sample, withCard }) {
  // 只有一道题的一组：附拆解时，题目带上 standardId，编码就会把这道题的拆解附给模型（src/standard.js）。
  const round = {
    index: 1,
    offered: [{ qid: "q", axis: q.axis, text: q.text, ...(withCard ? { standardId: q.id } : {}) }],
    choice: "q",
    answer: sample.answer,
    followUp: null,
    probes: [],
  };
  return codeRound(ctx, round);
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const errorText = (e) => (e?.name === "LLMError" ? `${t(`error.${e.kind}`)}${e.message && e.message !== e.kind ? `（${e.message}）` : ""}` : String(e?.message ?? e));

// ---------- 报告 ----------

const LABELS = { lean: "倾向", deferral: "暂缓", deferredTo: "交给谁", criteria: "判断标准（提到应有的）" };
const pct = ({ right, total }) => (total ? `${right}/${total}（${Math.round((right / total) * 100)}%）` : "—");
const LEAN_NAMES = { conditional: "有条件", deferred: "暂缓", other: "第三条路", none: "没有实质内容" };
const DEFERRAL_NAMES = { none: "没暂缓", conditional: "说清了缺什么", open: "没说清" };
function brief(c, axisId) {
  if (!c) return "（没编出来）";
  const ax = content.axisById[axisId];
  const lean = c.lean === "left" ? `左（${ax.left}）` : c.lean === "right" ? `右（${ax.right}）` : LEAN_NAMES[c.lean] ?? c.lean;
  return `倾向=${lean}，暂缓=${DEFERRAL_NAMES[c.deferral] ?? c.deferral}，交给谁=[${(c.deferred_to ?? []).join("、")}]，判断标准=[${(c.criteria ?? []).join("、")}]`;
}

function renderReport(results, summary) {
  const modeName = (withCard) => (withCard ? "附拆解" : "不附拆解");
  const lines = [
    `# 编码检查：${SETUP.label} / ${MODEL}`,
    "",
    `${new Date().toLocaleString("zh-CN")}；标准题 ${questions.length} 道，每道 ${questions[0].samples.length} 份样例回答，每份编码一次。`,
    "附拆解：模型看到的就是以后标准题进正式轮次时附的那段拆解。不附拆解：和现在正式轮次里普通题的编码一样。",
    "",
    `| 这一项编对了几份 | ${MODES.map(modeName).join(" | ")} |`,
    `|---|${MODES.map(() => "---").join("|")}|`,
    ...SCORE_KEYS.map((k) => `| ${LABELS[k]} | ${MODES.map((m) => pct(summary.get(m)[k])).join(" | ")} |`),
    "",
    "## 没编对的",
  ];
  for (const withCard of MODES) {
    lines.push("", `### ${modeName(withCard)}`, "");
    const wrong = results.filter((r) => r.withCard === withCard && (!r.score || SCORE_KEYS.some((k) => r.score[k] === false)));
    if (!wrong.length) lines.push("都对了。");
    for (const r of wrong) {
      const missed = r.score ? SCORE_KEYS.filter((k) => r.score[k] === false).map((k) => LABELS[k]).join("、") : "编码失败";
      lines.push(`- ${r.id}"${r.answer}"`, `  - 没对上：${missed}`, `  - 应该：${brief(r.expect, r.axis)}`, `  - 编成：${r.error ? `出错了：${r.error}` : brief(r.coding, r.axis)}`);
    }
  }
  const price = PRICES[MODEL];
  lines.push(
    "",
    "## 用量",
    "",
    `${usage.calls} 次调用（含格式不对时的重试），输入 ${usage.input} token，输出 ${usage.output} token${
      price ? `，约 ${((usage.input * price[0] + usage.output * price[1]) / 1e6).toFixed(3)} 美元` : ""
    }。`,
  );
  return lines.join("\n");
}

// ---------- 主流程 ----------

async function main() {
  console.log(`编码检查：${SETUP.label} / ${MODEL}；${questions.length} 道题，${jobs.length} 次编码（${MODES.length === 2 ? "附拆解、不附拆解各一遍" : MODES[0] ? "只跑附拆解" : "只跑不附拆解"}）。`);
  const apiKey = await getKey();
  const ctx = {
    settings: normalizeSettings({ main: { provider: SETUP.id, model: MODEL, baseURL: SETUP.baseURL ?? "" }, auditor: { mode: "same", model: MODEL } }),
    secrets: { keys: { [SETUP.id]: apiKey } },
    content,
    demo: false,
    demoState: null,
  };

  // 先单独跑一份：key 不对、服务没开、模型名写错，在这里就停下，不白跑剩下的。
  let first;
  try {
    first = await codeOne(ctx, jobs[0]);
  } catch (e) {
    const hint = PROVIDER === "mock" ? "先在另一个终端运行 node tools/mock-llm-server.mjs。" : "看看 key 和模型名对不对。";
    fail(`第一份就没编出来：${errorText(e)}\n${hint}`);
  }

  let done = 1;
  const results = await pool(jobs, 4, async (job, i) => {
    let coding = null;
    let error = null;
    try {
      coding = i === 0 ? first : await codeOne(ctx, job);
    } catch (e) {
      error = errorText(e);
    }
    if (i > 0) done++;
    process.stdout.write(`\r已编码 ${done}/${jobs.length}`);
    return {
      id: job.q.id,
      axis: job.q.axis,
      withCard: job.withCard,
      answer: job.sample.answer,
      expect: job.sample.expect,
      coding: coding && { lean: coding.lean, deferral: coding.deferral, deferred_to: coding.deferred_to, criteria: coding.criteria, flip_conditions: coding.flip_conditions, missing_info: coding.missing_info },
      score: coding ? scoreCoding(job.sample.expect, coding) : null,
      error,
    };
  });
  process.stdout.write("\n");

  const summary = new Map(MODES.map((m) => [m, tally(results.filter((r) => r.withCard === m).map((r) => r.score))]));
  const report = renderReport(results, summary);
  const dir = `${ROOT}sim-output/check-coder-${stamp()}-${PROVIDER}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.md`, report);
  writeFileSync(`${dir}/results.json`, JSON.stringify({ provider: PROVIDER, model: MODEL, results, usage }, null, 2));

  console.log("");
  for (const k of SCORE_KEYS) console.log(`${LABELS[k]}：${MODES.map((m) => `${m ? "附拆解" : "不附拆解"} ${pct(summary.get(m)[k])}`).join("；")}`);
  const errors = results.filter((r) => r.error).length;
  if (errors) console.log(`有 ${errors} 份没编出来，原因见报告。`);
  console.log(`\n详细结果：${dir}/report.md`);
}

main();
