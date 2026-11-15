// 本地服务器 tools/serve.mjs：只认本机地址；解不开的地址不会让它退出；不给 .git、私人材料这些（安全审查第 6 条）。
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { allowedHost, publicPath, startServer } from "../tools/serve.mjs";

test("only requests addressed to this machine are served", () => {
  assert.equal(allowedHost("127.0.0.1:8000", 8000), true);
  assert.equal(allowedHost("localhost:8000", 8000), true);
  assert.equal(allowedHost("attacker.example", 8000), false, "DNS rebinding: the Host is the attacker's name");
  assert.equal(allowedHost("127.0.0.1:8001", 8000), false);
  assert.equal(allowedHost(undefined, 8000), false);
});

test("private, hidden and undecodable paths are not served", () => {
  assert.equal(publicPath("/"), "/");
  assert.equal(publicPath("/src/app.js?v=1"), "/src/app.js");
  assert.equal(publicPath("/design/02-axes-v0.md"), "/design/02-axes-v0.md");
  for (const bad of ["/%E0%A4%A", "/.git/HEAD", "/.claude/launch.json", "/src/../.git/config", "/%2e%2e/.git/HEAD", "/HL-CST/x.docx", "/hl-cst/x", "/sim-output/a/report.md", "/node_modules/x/index.js", "/src%5C..%5C.git%5CHEAD"]) {
    assert.equal(publicPath(bad), null, bad);
  }
});

function get(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the server refuses foreign hosts and survives a malformed path", async () => {
  const server = startServer(0, { quiet: true });
  await once(server, "listening");
  const { port } = server.address();
  const me = `127.0.0.1:${port}`;
  try {
    assert.equal(await get(port, "/", me), 200);
    assert.equal(await get(port, "/", `localhost:${port}`), 200);
    assert.equal(await get(port, "/", "attacker.example"), 403);
    assert.equal(await get(port, "/%E0%A4%A", me), 404);
    assert.equal(await get(port, "/", me), 200, "still running after the malformed request");
    assert.equal(await get(port, "/.git/HEAD", me), 404);
    assert.equal(await get(port, "/HL-CST/", me), 404);
  } finally {
    server.close();
  }
});
