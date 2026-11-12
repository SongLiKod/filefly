// 查询语法解析器（F-11：size:>100MB ext:pdf modified:today tag:工作，技术文档 §4.3）
// 前端 Lexer → Query AST（结构与 Rust QueryAst 对应），Rust 侧生成 SQL
import type { QueryInput } from "@/ipc/types";

const SIZE_RE = /^size:(>=|<=|>|<|=)?([\d.]+)(KB|MB|GB|B)?$/i;
const EXT_RE = /^ext:(.+)$/i;
const MODIFIED_RE = /^modified:(today|week|month)$/i;
const TAG_RE = /^tag:(.+)$/i;

export function parseQuery(input: string): QueryInput {
  const q: QueryInput = { text: "" };
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(SIZE_RE))) {
      const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[3].toLowerCase() as "b" | "kb" | "mb" | "gb"];
      const v = parseFloat(m[2]) * mult;
      const op = m[1] ?? ">";
      if (op.includes(">")) q.minSize = op === ">" ? v + 1 : v;
      else if (op.includes("<")) q.maxSize = op === "<" ? v - 1 : v;
      else { q.minSize = v; q.maxSize = v; }
    } else if ((m = part.match(EXT_RE))) {
      q.ext = m[1].toLowerCase();
    } else if ((m = part.match(MODIFIED_RE))) {
      q.modified = m[1].toLowerCase() as "today" | "week" | "month";
    } else if ((m = part.match(TAG_RE))) {
      q.tag = m[1];
    } else {
      words.push(part);
    }
  }
  q.text = words.join(" ");
  return q;
}
