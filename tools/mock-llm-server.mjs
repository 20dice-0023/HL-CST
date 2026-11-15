// 本地模拟的 OpenAI 兼容服务：不花钱地走一遍真实的请求路径（设置 → 测试连接 → 出题 → 报告）。
// 运行：node tools/mock-llm-server.mjs [端口，默认 8787]
// 然后在设置里选"其它 OpenAI 兼容服务"，接口地址填 http://127.0.0.1:8787/v1 ，key 随便填，模型填 mock-large。
// 返回的内容都是占位文字，只用来测流程。

import http from "node:http";

const PORT = Number(process.argv[2] ?? 8787);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function schemaOf(body) {
  const fromFormat = body.response_format?.json_schema?.schema;
  if (fromFormat) return fromFormat;
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const i = system.indexOf("JSON Schema：");
  if (i >= 0) {
    try {
      return JSON.parse(system.slice(i + "JSON Schema：".length));
    } catch {
      return null;
    }
  }
  return null;
}

function respond(body) {
  const schema = schemaOf(body) ?? {};
  const props = Object.keys(schema.properties ?? {});
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";

  if (props.includes("questions")) {
    const slots = [...user.matchAll(/编号 (\d+)\n- 轴：(A\d) ([^：]+)：[\s\S]*?- 情境：([^；]+)；/g)];
    // 把受试者情况的第一句也放进题面，方便在页面上核对提示词有没有带上身份。
    const who = ((user.match(/受试者现在的情况：(.*)/) ?? [])[1] ?? "（没带）").split(/[，。]/)[0];
    return {
      questions: slots.map(([, slot, axis, name, carrier]) => ({
        slot: Number(slot),
        text: `模拟题（${axis}）：在${carrier}里，你碰到一件和"${name.trim()}"有关的事，有一处关键信息还不清楚。受试者：${who}。这是本地模拟服务生成的占位题目，只用来测试流程。你会怎么做？`,
      })),
    };
  }
  if (props.includes("results")) {
    const qs = [...user.matchAll(/编号 (\d+)：.*?（(A\d)）/g)];
    return { results: qs.map(([, slot, axis]) => ({ slot: Number(slot), main_axis: axis, secondary_axes: [], problems: [], note: "" })) };
  }
  if (props.includes("lean")) {
    const answer = (user.match(/回答：(.*)/) ?? [])[1] ?? "";
    const deferred = /看情况|再看看|暂缓|先不|不确定/.test(answer);
    const probe = /补全追问/.test(user);
    return {
      lean: deferred ? "deferred" : "left",
      deferral: deferred ? "open" : "none",
      missing_info: deferred ? ["结果会怎样"] : [],
      criteria: ["模拟标准"],
      flip_conditions: [],
      deferred_to: [],
      quotes: answer ? [answer.slice(0, 20)] : [],
      question_problem: "",
      probe_outcome: probe ? "decided" : "none",
      reasoning: {
        basis: /以前|别人|大家|一般/.test(answer) ? "experience" : /会|结果|后果/.test(answer) ? "consequence" : "none",
        weighing: /万一|最坏|保险|稳妥/.test(answer) ? "worst_case" : /划算|值得|权衡/.test(answer) ? "overall" : "none",
        scope: /以后|每次|规矩|原则/.test(answer) ? "as_a_rule" : /这次|眼下/.test(answer) ? "this_time" : "none",
        likelihood: /可能|多半|万一/.test(answer) ? "mentioned" : "not_mentioned",
        certainty: deferred ? "unsure" : /肯定|一定/.test(answer) ? "sure" : "hedged",
      },
    };
  }
  if (props.includes("confirmed")) return { confirmed: false, note: "模拟复查：题目没有问题" };
  if (props.includes("reviews")) {
    const n = [...user.matchAll(/^\d+\. /gm)].length;
    return { reviews: Array.from({ length: n }, (_, i) => ({ index: i + 1, pass: true, problems: [], rewrite_statement: "", rewrite_prediction: "" })) };
  }
  if (props.includes("hypotheses")) {
    return {
      criteria: [{ label: "模拟标准", rounds: [1, 2, 3], quotes: ["模拟原话"] }],
      hypotheses: [
        {
          statement: "（模拟）在信息不全的情境下，你倾向于先把能确定的部分做掉。",
          evidence: [
            { round: 1, channel: "回答", note: "模拟依据一" },
            { round: 2, channel: "选择", note: "模拟依据二" },
          ],
          counter: ["本次没有发现反例"],
          alternatives: ["这是模拟数据"],
          confidence: "低",
          confidence_reason: "模拟服务生成",
          prediction: "（模拟）如果下次你在同类题里先等信息再动手，这条就不成立。",
        },
      ],
      prior_checks: [],
      moments: ["（模拟）下次碰到信息不全的事，可以留意自己先做的是哪一步。"],
    };
  }
  if (props.includes("text")) return { text: "（模拟）假设结果不会太糟。现在呢？你也可以继续暂缓。" };
  return { ok: true };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === "GET" && req.url.endsWith("/models")) {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-large" }, { id: "mock-small" }, { id: "mock-embedding" }] }));
  }
  if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "bad json" } }));
      }
      const content = JSON.stringify(respond(body));
      setTimeout(() => {
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
      }, 200);
    });
    return;
  }
  res.writeHead(404, CORS);
  res.end();
});

// 只听本机，和 serve.mjs 一样：局域网里的设备连不上（安全审查第 7 条）。
server.listen(PORT, "127.0.0.1", () => console.log(`mock LLM server on http://127.0.0.1:${PORT}/v1`));
