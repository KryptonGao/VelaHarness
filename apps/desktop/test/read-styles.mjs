import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** 读取样式文件并把 `@import "./x.css";` 就地展开,供把样式内联进夹具页面的测试使用;顺序与真实打包一致。 */
export function readStyles(file) {
  const base = dirname(file);
  return readFileSync(file, "utf8").replace(/^@import "([^"]+)";[ \t]*\n?/gm, (_, rel) => readStyles(resolve(base, rel)));
}
