// 本地开发用的静态服务器。和 python -m http.server 的区别：
// 1. 每个响应都带 Cache-Control: no-store，改了文件刷新就能看到，浏览器不会继续用缓存住的旧模块；
// 2. 只听本机（127.0.0.1），局域网里的其他设备连不上（仓库目录里可能放着不公开的材料）。
// 运行：npm run serve，或 node tools/serve.mjs [端口，默认 8000]

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.argv[2] ?? 8000);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function resolveFile(urlPath) {
  const file = normalize(join(ROOT, decodeURIComponent(urlPath)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null; // 不许跑出仓库目录
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  return info.isDirectory() ? join(file, "index.html") : file;
}

const server = http.createServer(async (req, res) => {
  const headers = { "Cache-Control": "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, headers);
    return res.end();
  }
  const file = await resolveFile(new URL(req.url, "http://localhost").pathname);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!body) {
    res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    return res.end("not found");
  }
  res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.listen(PORT, "127.0.0.1", () => console.log(`HL-CST dev server on http://localhost:${PORT}/`));
