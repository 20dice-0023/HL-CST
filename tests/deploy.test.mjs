// 部署配置（修订记录第 19 轮）：网站要用的文件都会上传，修订记录、测试、工具、archive 这些不上传。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS } from "../src/views/how.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

// .assetsignore 里只用了两种写法：以 / 结尾的目录，和从根目录算起的文件或目录名。
const patterns = read(".assetsignore")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const ignored = (path) => patterns.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));

const filesUnder = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

test("everything the site loads is uploaded", () => {
  const needed = ["index.html", "LICENSE", "LICENSE-CONTENT.md", ...filesUnder("src"), ...filesUnder("content"), ...filesUnder("vendor"), ...DOCS.map((d) => `design/${d}.md`)];
  assert.deepEqual(needed.filter(ignored), []);
});

test("the changelog, tests, tools, archive and project files stay off the site", () => {
  for (const p of ["design/changelog.md", "tests/deploy.test.mjs", "tools/serve.mjs", "archive/any.pdf", "package.json", "package-lock.json", ".gitignore", "README.md", "wrangler.jsonc", "node_modules/x/index.js", ".git/config"]) {
    assert.ok(ignored(p), `${p} would be uploaded`);
  }
});

test("wrangler.jsonc deploys the repository root as static files, with one fixed address", () => {
  const config = JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.name, "hl-cst", "must match the Worker connected in Cloudflare");
  assert.equal(config.assets.directory, ".");
  assert.equal(config.main, undefined, "no Worker script: static files only");
  assert.equal(config.preview_urls, false);
});
