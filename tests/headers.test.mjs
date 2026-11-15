// 托管用的响应头（_headers）和 index.html 里 meta 的 CSP 要一致，响应头只多一条 frame-ancestors；
// 页面开着 Trusted Types，源码里也确实没有会被它拦下的写法（修订记录第 18 轮，安全审查第 1、8 条）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const directives = (csp) =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(/\s+/)[0], d]),
  );

const metaCSP = read("index.html").match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
const headerLines = read("_headers")
  .split("\n")
  .filter((l) => /^\s+[\w-]+:/.test(l))
  .map((l) => l.trim());
const header = (name) => headerLines.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();

test("the hosting CSP matches the page's own CSP, plus frame-ancestors", () => {
  const meta = directives(metaCSP);
  const hosted = directives(header("Content-Security-Policy"));
  for (const [name, d] of meta) assert.equal(hosted.get(name), d, `${name} differs`);
  assert.deepEqual([...hosted.keys()].filter((k) => !meta.has(k)), ["frame-ancestors"]);
  assert.equal(hosted.get("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.match(header("Strict-Transport-Security") ?? "", /max-age=\d+/);
});

test("the page enforces Trusted Types, and no code writes HTML that it would block", () => {
  const meta = directives(metaCSP);
  assert.equal(meta.get("require-trusted-types-for"), "require-trusted-types-for 'script'");
  assert.equal(meta.get("trusted-types"), "trusted-types 'none'");
  const files = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : [],
    );
  const sinks = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\.srcdoc\s*=|new Function\(|\beval\(|parseFromString\(/;
  const hits = [...files("src"), ...files("vendor")].filter((f) => sinks.test(read(f)));
  assert.deepEqual(hits, []);
});
