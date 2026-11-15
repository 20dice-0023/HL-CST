// 极简的 Markdown 解析：只认设计稿里用到的写法（标题、段落、列表和一层嵌套、引用、表格、代码块、分隔线、
// 加粗、斜体、行内代码、链接）。只产出结构，不产出 HTML；网页里由 views/how.js 用文本节点拼成页面。

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^\s*```/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const CJK = /[⺀-鿿　-〿＀-￯]/;

const isTableStart = (line, next) => /^\s*\|/.test(line) && next !== undefined && TABLE_SEPARATOR.test(next);

function isBlockStart(line, next) {
  return FENCE.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line) || LIST_ITEM.test(line) || isTableStart(line, next) || /^\s*(-{3,}|\*{3,})\s*$/.test(line);
}

// 段落里换行接起来：两边有一边是中文就直接接上，否则隔一个空格。
function joinLines(lines) {
  return lines.reduce((acc, line) => (!acc ? line : CJK.test(acc.at(-1)) || CJK.test(line[0]) ? acc + line : `${acc} ${line}`), "");
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => parseInline(cell.trim().replace(/\\\|/g, "|")));

/** 一段文字里的加粗、斜体、行内代码和链接。 */
export function parseInline(text) {
  const out = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if (rest[0] === "\\" && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (rest[0] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      out.push({ type: "link", href: m[2], children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (rest[0] === "*" && rest[1] && rest[1] !== " " && rest[1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

function parseList(lines, start) {
  const first = lines[start].match(LIST_ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // 空行之后还是同一层的条目（或者更深一层的内容），列表就接着；否则到此为止。
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length ? lines[j] : "";
      const nm = next.match(LIST_ITEM);
      const deeper = next.match(/^(\s*)/)[1].length > indent;
      if ((nm && nm[1].length === indent && /\d/.test(nm[2]) === ordered) || (deeper && items.length)) {
        if (deeper && items.length) items.at(-1).lines.push("");
        i = j;
        continue;
      }
      break;
    }
    const m = line.match(LIST_ITEM);
    const lineIndent = line.match(/^(\s*)/)[1].length;
    if (m && lineIndent === indent) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ number: ordered ? Number(m[2].slice(0, -1)) : null, lines: [m[3]] });
      i++;
      continue;
    }
    if (lineIndent > indent && items.length) {
      items.at(-1).lines.push(line);
      i++;
      continue;
    }
    if (lineIndent < indent || isBlockStart(line, lines[i + 1])) break;
    // 没缩进、也不是新的块：接在上一条后面（Markdown 的"懒惰续行"）。
    items.at(-1).lines.push(line.trim());
    i++;
  }
  const block = {
    type: "list",
    ordered,
    start: ordered ? items[0]?.number ?? 1 : null,
    items: items.map((it) => {
      const [head, ...more] = it.lines;
      const pad = Math.min(...more.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length), Infinity);
      const body = more.map((l) => (Number.isFinite(pad) ? l.slice(pad) : l));
      return { blocks: parseBlocks([head, ...body]) };
    }),
  };
  return { block, next: i };
}

/** 把一份 Markdown 拆成块。 */
export function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++; // 收尾的 ```
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2].trim()) });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", blocks: parseBlocks(buf) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) buf.push(lines[i++].trim());
    blocks.push({ type: "paragraph", inline: parseInline(joinLines(buf)) });
  }
  return blocks;
}

export const parseMarkdown = (text) => parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
