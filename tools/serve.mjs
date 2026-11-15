// 本地开发用的静态服务器。和 python -m http.server 的区别：
// 1. 每个响应都带 Cache-Control: no-store，改了文件刷新就能看到，浏览器不会继续用缓存住的旧模块；
// 2. 只听本机（127.0.0.1），局域网里的其他设备连不上（仓库目录里可能放着不公开的材料）；
// 3. 只认 Host 是本机地址的请求：恶意网页借 DNS 重绑定把自己的域名指到 127.0.0.1 时，Host 是它的域名，一律拒绝；
// 4. 不给以点开头的（.git、.claude）、私人材料 /HL-CST/、模拟结果 /sim-output/ 和 /node_modules/；
//    地址解不开的回 404，不会让整个服务器退出（3、4 两条见安全审查第 6 条，修订记录第 18 轮）。
// 运行：npm run serve，或 node tools/serve.mjs [端口，默认 8000]

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
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

/** 只认本机地址加这个端口。 */
export const allowedHost = (host, port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

// 以点开头的路径段，或者私人材料、模拟结果、依赖目录。Windows 的文件名不分大小写，这里也不分。
const HIDDEN = /(?:^|\/)\.|^\/(?:HL-CST|sim-output|node_modules)(?:\/|$)/i;

/** 地址里的路径；解不开，或者是不对外的，返回 null。 */
export function publicPath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  } catch {
    return null;
  }
  return HIDDEN.test(pathname.replace(/\\/g, "/")) ? null : pathname;
}

async function resolveFile(pathname) {
  const file = normalize(join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null; // 不许跑出仓库目录
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  return info.isDirectory() ? join(file, "index.html") : file;
}

/** 起服务器；port 给 0 时由系统挑一个空闲端口（测试用）。 */
export function startServer(port, { quiet = false } = {}) {
  let actualPort = port;
  const server = http.createServer(async (req, res) => {
    const headers = { "Cache-Control": "no-store" };
    const notFound = () => {
      res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, headers);
        return res.end();
      }
      if (!allowedHost(req.headers.host, actualPort)) {
        res.writeHead(403, headers);
        return res.end();
      }
      const pathname = publicPath(req.url);
      const file = pathname === null ? null : await resolveFile(pathname);
      const body = file ? await readFile(file).catch(() => null) : null;
      if (!body) return notFound();
      res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      // 哪个请求出了意外，都只影响它自己，服务器接着跑。
      if (!res.headersSent) res.writeHead(500, headers);
      res.end();
    }
  });
  server.listen(port, "127.0.0.1", () => {
    actualPort = server.address().port;
    if (!quiet) console.log(`HL-CST dev server on http://localhost:${actualPort}/`);
  });
  return server;
}

const isMain = () => {
  if (!process.argv[1]) return false;
  const [a, b] = [resolve(process.argv[1]), fileURLToPath(import.meta.url)];
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
};
if (isMain()) startServer(Number(process.argv[2] ?? 8000));
