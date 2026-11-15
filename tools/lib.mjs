// tools/ 里几个脚本共用的：读本地的内容文件、在终端里不回显地读 key。

import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { splitPrompt } from "../src/text.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PROMPTS = ["writer", "auditor-questions", "coder", "probe", "analyst", "auditor-hypotheses", "auditor-recheck", "ping"];

/** 和网页里 loadContent 读出来的一样（src/content.js），另外可以带上标准题。 */
export function loadContentFromDisk({ standard = false } = {}) {
  const read = (p) => readFileSync(`${ROOT}content/zh/${p}`, "utf8");
  const axesFile = JSON.parse(read("axes.json"));
  return {
    locale: "zh",
    axisTableVersion: axesFile.version,
    axes: axesFile.axes,
    axisIds: axesFile.axes.map((a) => a.id),
    axisById: Object.fromEntries(axesFile.axes.map((a) => [a.id, a])),
    packages: JSON.parse(read("packages.json")),
    wordlists: JSON.parse(read("wordlists.json")),
    ui: JSON.parse(read("ui.json")),
    prompts: Object.fromEntries(PROMPTS.map((n) => [n, splitPrompt(read(`prompts/${n}.md`))])),
    ...(standard ? { standard: JSON.parse(read("standard.json")) } : {}),
  };
}

/** 不回显地读一行（粘贴 key 用）。去掉终端可能夹带的粘贴标记和控制字符。 */
export function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buf = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(buf.replace(/\x1b\[[0-9;?]*[~A-Za-z]/g, "").replace(/[^\x21-\x7e]/g, ""));
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") return finish();
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    process.stdout.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** 输出目录名里用的时间：2026-11-15T12-30-00。 */
export const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
