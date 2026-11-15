// 界面上每一个 t("…") 都要在 ui.json 里有对应的文案，免得页面上露出键名。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIFE_STAGES } from "../src/life-stage.js";
import { QUESTION_PROBLEMS } from "../src/schemas.js";
import { SIZES, THEMES } from "../src/display.js";
import { REASONING_DIMS } from "../src/reasoning.js";
import { DOCS } from "../src/views/how.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const ui = JSON.parse(readFileSync(join(root, "content/zh/ui.json"), "utf8"));
const has = (k) => typeof k.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), ui) === "string";

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : p.endsWith(".js") ? [p] : [];
  });
}

// 用模板字符串拼出来的键，静态扫描看不到，单独列出。
const PROVIDERS = ["anthropic", "openai", "gemini", "deepseek", "local", "custom"];
const DYNAMIC = [
  ...["insufficient", "neutral", "avoid", "avoid_strong", "prefer", "prefer_strong"].map((k) => `report.judgment.${k}`),
  ...PROVIDERS.flatMap((p) => [`settings.providers.${p}`, `settings.badge.${p}`, `settings.retention.${p}`]),
  ...["auth", "rate", "network", "timeout", "refusal", "truncated", "bad_output", "not_found", "bad_request", "server", "config", "unknown"].map((k) => `error.${k}`),
  ...["p1", "p2", "p3"].map((k) => `consent.${k}`),
  ...LIFE_STAGES.map((k) => `consent.stages.${k}`),
  ...Object.keys(REASONING_DIMS).map((k) => `report.reasoning.dims.${k}`),
  ...Object.values(REASONING_DIMS).flat().map((k) => `report.reasoning.values.${k}`),
  ...["conditional", "deferred", "other", "leftMasked", "rightMasked"].map((k) => `report.reasoning.leans.${k}`),
  ...[
    "title", "intro", "hedgedOrUnsure", "part", "countLine", "noneNote", "likelihoodLine", "stabilityTitle", "stabilityRow",
    "actionStable", "actionVaries", "unclear", "reasonStable", "reasonVaries", "reasonUnclear", "legend",
  ].map((k) => `report.reasoning.${k}`),
  ...THEMES.map((k) => `settings.themes.${k}`),
  ...SIZES.map((k) => `settings.sizes.${k}`),
  ...[...QUESTION_PROBLEMS, "length", "axis_mismatch"].map((k) => `report.problems.${k}`),
  "predict.most",
  "predict.least",
  ...["like", "unlike", "unsure"].map((k) => `report.card.${k}`),
  ...["likeHit", "likeMiss", "unlikeHit", "unlikeMiss", "pending"].map((k) => `report.s8.${k}`),
  ...["axis", "exposures", "chosen", "expected", "judgment"].map((k) => `report.s2.${k}`),
  ...["round", "offered", "choice", "audit"].map((k) => `report.s9.${k}`),
  ...DOCS.map((d) => `how.docs.${d}`),
];

test("every UI text key used in the code exists in ui.json", () => {
  const prefixes = Object.keys(ui).join("|");
  const literal = new RegExp(`["']((?:${prefixes})\\.[a-zA-Z0-9_.]+)["']`, "g");
  const missing = new Set();
  for (const f of sourceFiles(join(root, "src"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(literal)) if (!has(m[1])) missing.add(`${m[1]} (${f.slice(root.length)})`);
  }
  for (const k of DYNAMIC) if (!has(k)) missing.add(`${k} (dynamic)`);
  assert.deepEqual([...missing], []);
});
