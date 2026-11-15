// 发给服务商的请求：DeepSeek 按步骤设思考强度，其它服务商不受影响；Claude 的请求只发往官方地址；等太久要报超时。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSettings, resolveTarget } from "../src/settings.js";
import { openaiCall } from "../src/providers/openai-compatible.js";
import { anthropicCall } from "../src/providers/anthropic.js";
import { APP_VERSION } from "../src/session.js";
import { redactSecrets } from "../src/errors.js";

const secrets = { keys: { deepseek: "test-key", openai: "test-key", anthropic: "test-key" } };
const deepseekOnly = normalizeSettings({ main: { provider: "deepseek", model: "deepseek-flash" }, auditor: { mode: "same", model: "" } });
const effort = (settings, role) => resolveTarget(settings, secrets, role).extraBody.reasoning_effort;

test("DeepSeek thinks hard only where it pays off", () => {
  assert.equal(effort(deepseekOnly, "analyst"), "high");
  for (const role of ["writer", "auditorQuestions", "auditorHypotheses", "recheck"]) assert.equal(effort(deepseekOnly, role), "low", role);
  for (const role of ["coder", "coder2", "probe", "ping", "pingAuditor"]) assert.equal(effort(deepseekOnly, role), "none", role);
});

test("other providers get no reasoning parameter", () => {
  const openai = normalizeSettings({ main: { provider: "openai", model: "gpt-x" }, auditor: { mode: "same", model: "gpt-y" } });
  assert.deepEqual(resolveTarget(openai, secrets, "writer").extraBody, { store: false });
  const anthropic = normalizeSettings({});
  assert.deepEqual(resolveTarget(anthropic, secrets, "coder").extraBody, {});
});

test("a DeepSeek auditor next to another main provider still gets its own settings", () => {
  const mixed = normalizeSettings({
    main: { provider: "anthropic", model: "claude-opus-5-5" },
    auditor: { mode: "separate", provider: "deepseek", separateModel: "deepseek-flash" },
  });
  assert.equal(effort(mixed, "writer"), undefined);
  assert.equal(effort(mixed, "coder2"), "none");
  assert.equal(effort(mixed, "auditorQuestions"), "low");
});

test("the request body carries reasoning_effort and only two headers", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const tg = resolveTarget(deepseekOnly, secrets, "coder");
    const res = await openaiCall({ ...tg, system: "只输出 json", user: "测试", schema: { type: "object" } });
    assert.equal(res.text, '{"ok":true}');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(seen[0].body.reasoning_effort, "none");
  assert.deepEqual(seen[0].body.response_format, { type: "json_object" });
  assert.deepEqual(Object.keys(seen[0].headers).sort(), ["Authorization", "Content-Type"]);
});

test("Claude requests go to the official address with only the key that was typed in", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  const saved = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };
  // 在 Node 里，SDK 会读这两个环境变量；设了也不能改变请求发到哪儿、带什么凭证。
  process.env.ANTHROPIC_BASE_URL = "http://elsewhere.invalid";
  process.env.ANTHROPIC_AUTH_TOKEN = "token-from-environment";
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const message = { id: "msg_test", type: "message", role: "assistant", model: seen.at(-1).body.model, content: [{ type: "text", text: '{"ok": true}' }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  try {
    for (const model of ["claude-opus-5-5", "claude-haiku-5-5"]) {
      const res = await anthropicCall({ apiKey: "typed-in-key", model, system: "系统", user: "用户", schema, effort: "medium" });
      assert.equal(res.text, '{"ok": true}');
      assert.deepEqual(res.usage, { input_tokens: 3, output_tokens: 2 });
    }
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of [["ANTHROPIC_BASE_URL", saved.base], ["ANTHROPIC_AUTH_TOKEN", saved.token]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(seen.length, 2);
  for (const r of seen) {
    assert.ok(r.url.startsWith("https://api.anthropic.com/v1/messages"), r.url);
    assert.equal(r.headers.get("authorization"), "Bearer typed-in-key");
    assert.equal(r.headers.get("x-api-key"), null);
    assert.deepEqual(r.body.output_config, { format: { type: "json_schema", schema }, effort: "medium" });
    assert.equal(r.body.temperature, undefined);
  }
  const [opus, haiku] = seen;
  assert.equal(opus.body.fallbacks, "default", "Opus asks for the server-side refusal fallback");
  assert.equal(opus.headers.get("anthropic-beta"), "server-side-fallback-2026-07-01");
  assert.equal(haiku.body.fallbacks, undefined, "Haiku has no server-side fallback");
  assert.equal(haiku.headers.get("anthropic-beta"), null);
});

test("a provider that never answers ends in a timeout error, not an endless wait", async () => {
  const realFetch = globalThis.fetch;
  const target = { baseURL: "http://stub.local/v1", apiKey: "k", model: "m", system: "s", user: "u", schema: { type: "object" }, jsonMode: "json_object" };
  try {
    let signal;
    globalThis.fetch = async (_url, init) => {
      signal = init.signal;
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    await assert.rejects(openaiCall(target), (e) => e.kind === "timeout");
    assert.ok(signal instanceof AbortSignal, "the request carries a time limit");

    globalThis.fetch = async () => new Response("<html>gateway error page</html>", { status: 200 });
    await assert.rejects(openaiCall(target), (e) => e.kind === "bad_output", "a reply that is not JSON is reported as a format problem");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("package.json carries the same version the sessions record", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, APP_VERSION);
});

test("OpenAI, Gemini and DeepSeek always use their official address, even if an old one was stored", () => {
  const stale = normalizeSettings({ main: { provider: "deepseek", model: "deepseek-flash", baseURL: "https://evil.example/v1" }, auditor: { mode: "same", model: "" } });
  assert.equal(resolveTarget(stale, secrets, "writer").baseURL, "https://api.deepseek.com");
  const custom = normalizeSettings({ main: { provider: "custom", model: "m", baseURL: "https://my.example/v1/" }, auditor: { mode: "same", model: "" } });
  assert.equal(resolveTarget(custom, { keys: { custom: "k" } }, "writer").baseURL, "https://my.example/v1");
});

test("a provider error that echoes the key never shows it", async () => {
  const key = "sk-test-0123456789abcdef";
  assert.equal(redactSecrets(`bad key ${key}, header Bearer ${key}`, key), "bad key ***, header Bearer ***");
  assert.equal(redactSecrets("AIzaSyA1234567890abcdefghijklmnop and sk-proj-abcdefgh123", ""), "*** and ***");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Response(JSON.stringify({ error: { message: `bad request for key ${init.headers.Authorization}` } }), { status: 400 });
  try {
    await assert.rejects(
      openaiCall({ baseURL: "http://stub.local/v1", apiKey: key, model: "m", system: "s", user: "u", schema: { type: "object" }, jsonMode: "none" }),
      (e) => e.kind === "bad_request" && !e.message.includes(key) && e.message.includes("***"),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
