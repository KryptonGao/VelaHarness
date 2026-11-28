import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import { describeBashCommand } from "../src/renderer/components/bash-intent.ts";
import { bashIntentDisplay } from "../src/renderer/components/bash-intent-label.ts";
import { compactLabelParts } from "../src/renderer/components/tool-compact.ts";

describe("describeBashCommand", () => {
  it("ls 归为列目录,目标取第一个路径参数", () => {
    assert.deepEqual(describeBashCommand("ls"), { kind: "list", targets: [] });
    assert.deepEqual(describeBashCommand("ls -la src/main"), { kind: "list", targets: ["src/main"] });
    assert.deepEqual(describeBashCommand("ls -la 'my dir' | head -20"), { kind: "list", targets: ["my dir"] });
    assert.deepEqual(describeBashCommand("tree -L 2 packages"), { kind: "list", targets: ["packages"] });
  });

  it("cat / head / tail / sed -n 归为读取文件", () => {
    assert.deepEqual(describeBashCommand("cat package.json"), { kind: "read", targets: ["package.json"] });
    assert.deepEqual(describeBashCommand("cat a.ts b.ts"), { kind: "read", targets: ["a.ts", "b.ts"] });
    assert.deepEqual(describeBashCommand("head -n 20 src/a.ts"), { kind: "read", targets: ["src/a.ts"] });
    assert.deepEqual(describeBashCommand("tail -50 log.txt 2>/dev/null"), { kind: "read", targets: ["log.txt"] });
    assert.deepEqual(describeBashCommand("sed -n '10,40p' src/a.ts"), { kind: "read", targets: ["src/a.ts"] });
    assert.equal(describeBashCommand("sed -i 's/a/b/' src/a.ts"), null);
    assert.equal(describeBashCommand("sed 's/a/b/' src/a.ts"), null);
  });

  it("没有文件参数的 head/tail 读的是标准输入,不归类", () => {
    assert.equal(describeBashCommand("head -n 5"), null);
  });

  it("less / more / nl 的启动命令和带值选项不会被当成文件", () => {
    assert.deepEqual(describeBashCommand("less a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("less +F a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("less +/foo -N a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("less -p foo a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("more +20 a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("more -n 10 a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("nl -ba a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("nl -w 3 a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("nl -b a -s ': ' -v 5 a.ts b.ts"), { kind: "read", targets: ["a.ts", "b.ts"] });
    assert.deepEqual(describeBashCommand("nl --number-width=3 a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("nl --number-format ln a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.equal(describeBashCommand("nl"), null);
    assert.equal(describeBashCommand("less +F"), null);
  });

  it("单独的 - 是标准输入,不算文件", () => {
    assert.equal(describeBashCommand("cat -"), null);
    assert.equal(describeBashCommand("head -n 5 -"), null);
    assert.deepEqual(describeBashCommand("cat - a.ts"), { kind: "read", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("cat -- -weird"), { kind: "read", targets: ["-weird"] });
  });

  it("rm / unlink 删除明确写出的文件归为删除;目录、通配符、未知选项保持原样", () => {
    assert.deepEqual(describeBashCommand("rm a.ts"), { kind: "delete", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("rm -f a.ts b.ts"), { kind: "delete", targets: ["a.ts", "b.ts"] });
    assert.deepEqual(describeBashCommand("rm -fv -- -weird.ts"), { kind: "delete", targets: ["-weird.ts"] });
    assert.deepEqual(describeBashCommand("unlink a.ts"), { kind: "delete", targets: ["a.ts"] });
    assert.deepEqual(describeBashCommand("cd src && rm a.ts"), { kind: "delete", targets: ["a.ts"] });
    assert.equal(describeBashCommand("rm -rf build"), null);
    assert.equal(describeBashCommand("rm -r build"), null);
    assert.equal(describeBashCommand("rm -d empty"), null);
    assert.equal(describeBashCommand("rm *.log"), null);
    assert.equal(describeBashCommand("rm src/{a,b}.ts"), null);
    assert.equal(describeBashCommand("rm"), null);
    assert.equal(describeBashCommand("rm -f"), null);
    assert.equal(describeBashCommand("rm a.ts && npm install"), null);
    assert.equal(describeBashCommand("find . -name '*.log' -delete"), null);
    assert.equal(describeBashCommand("mv a b"), null);
    assert.equal(describeBashCommand("chmod +x a.sh"), null);
  });

  it("stat / xxd 等不读取文件内容的命令保持原样", () => {
    assert.equal(describeBashCommand("stat a.ts"), null);
    assert.equal(describeBashCommand("stat -f %z a.ts"), null);
    assert.equal(describeBashCommand("xxd -l 64 a.bin"), null);
    assert.equal(describeBashCommand("wc -l a.ts"), null);
  });

  it("grep / rg 归为搜索,区分搜索词和路径", () => {
    assert.deepEqual(describeBashCommand('grep -rn "useSession" src'), {
      kind: "search",
      targets: ["src"],
      query: "useSession",
    });
    assert.deepEqual(describeBashCommand("rg -n --glob '*.ts' foo apps packages"), {
      kind: "search",
      targets: ["apps", "packages"],
      query: "foo",
    });
    assert.deepEqual(describeBashCommand("grep -e foo -e bar src"), {
      kind: "search",
      targets: ["src"],
      query: "foo | bar",
    });
    assert.deepEqual(describeBashCommand("rg foo | head -20"), { kind: "search", targets: [], query: "foo" });
  });

  it("find / fd 归为查找文件,带 -exec / -delete 的不归类", () => {
    assert.deepEqual(describeBashCommand('find src -name "*.tsx" -type f'), {
      kind: "find",
      targets: ["src"],
      query: "*.tsx",
    });
    assert.deepEqual(describeBashCommand("find . -type f"), { kind: "find", targets: ["."] });
    assert.deepEqual(describeBashCommand("fd tool-card src"), { kind: "find", targets: ["src"], query: "tool-card" });
    assert.equal(describeBashCommand("find . -name '*.log' -delete"), null);
    assert.equal(describeBashCommand("find . -name '*.js' -exec rm {} \\;"), null);
  });

  it("复合命令、重定向和子 shell 保持原样", () => {
    assert.equal(describeBashCommand("ls && rm -rf build"), null);
    assert.equal(describeBashCommand("ls; npm install"), null);
    assert.equal(describeBashCommand('echo hi > out.txt; ls'), null);
    assert.equal(describeBashCommand("ls > out.txt"), null);
    assert.equal(describeBashCommand("cat $(which node)"), null);
    assert.equal(describeBashCommand("cat `which node`"), null);
    assert.equal(describeBashCommand("ls || true"), null);
    assert.equal(describeBashCommand("cat a.txt | node -e 'process.exit(1)'"), null);
    assert.equal(describeBashCommand("grep foo src &"), null);
    assert.equal(describeBashCommand("npm test"), null);
    assert.equal(describeBashCommand("ls 'unterminated"), null);
    assert.equal(describeBashCommand(""), null);
    assert.equal(describeBashCommand(undefined), null);
  });

  it("引号里的特殊字符不影响判断,2>&1 可以忽略", () => {
    assert.deepEqual(describeBashCommand('grep "a|b; c" src'), { kind: "search", targets: ["src"], query: "a|b; c" });
    assert.deepEqual(describeBashCommand("ls src 2>&1"), { kind: "list", targets: ["src"] });
  });

  it("用 ; 或 && 串联时,忽略 echo / pwd / cd,取第一段可归类的命令", () => {
    assert.deepEqual(describeBashCommand('ls -la ~/Desktop | head -30; echo "---"; echo $HOME'), {
      kind: "list",
      targets: ["~/Desktop"],
    });
    assert.deepEqual(describeBashCommand("cd src && ls"), { kind: "list", targets: ["src"] });
    assert.deepEqual(describeBashCommand("cd src; grep -rn foo"), { kind: "search", targets: ["src"], query: "foo" });
    assert.deepEqual(describeBashCommand("ls src && cat a.ts"), { kind: "list", targets: ["src"], more: 1 });
    assert.equal(describeBashCommand("echo hi"), null);
    assert.deepEqual(describeBashCommand('echo "a; b" && ls'), { kind: "list", targets: [] });
  });

  it("解释器跑 heredoc / -c / 脚本文件归为脚本,取首行有效代码作名称", () => {
    const command = [
      "cd ~/Desktop && python3 - <<'EOF'",
      "import re",
      "s=open('a.md',encoding='utf-8').read()",
      "print(len(s))",
      "EOF",
      "ls -l ~/Desktop/a.md",
    ].join("\n");
    assert.deepEqual(describeBashCommand(command), {
      kind: "script",
      language: "Python",
      targets: [],
      query: "s=open('a.md',encoding='utf-8').read()",
      more: 1,
    });
    assert.deepEqual(describeBashCommand('python3 -c "print(1)"'), {
      kind: "script",
      language: "Python",
      targets: [],
      query: "print(1)",
    });
    assert.deepEqual(describeBashCommand("node scripts/build.js --prod"), {
      kind: "script",
      language: "Node",
      targets: ["scripts/build.js"],
    });
    assert.deepEqual(describeBashCommand("node - <<EOF\n// hi\nconsole.log(1)\nEOF"), {
      kind: "script",
      language: "Node",
      targets: [],
      query: "console.log(1)",
    });
  });

  it("长脚本的显示名称保留完整首行，但不包含后续行", () => {
    const firstLine = `print('${"a".repeat(180)}')`;
    assert.equal(describeBashCommand(`python3 - <<'EOF'\n# comment\n${firstLine}\nprint(2)\nEOF`)?.query, firstLine);
  });

  it("python -m、交互解释器、bash -c、没写结束行的 heredoc 保持原样", () => {
    assert.equal(describeBashCommand("python3 -m pytest"), null);
    assert.equal(describeBashCommand("python3"), null);
    assert.equal(describeBashCommand('bash -c "rm -rf build"'), null);
    assert.equal(describeBashCommand("python3 - <<'EOF'\nprint(1)"), null);
    assert.equal(describeBashCommand("python3 - <<'EOF' > out.txt\nprint(1)\nEOF"), null);
  });

  it("命令带路径前缀也能识别", () => {
    assert.deepEqual(describeBashCommand("/bin/ls -l /tmp"), { kind: "list", targets: ["/tmp"] });
  });
});

function bash(command: string): ToolTrace {
  return { id: `bash-${Math.random().toString(36).slice(2, 8)}`, name: "bash", status: "done", activity: { command } };
}

describe("bashIntentDisplay 删除", () => {
  it("和创建文件一样拆成文件名 + 目录,并给出文件类型图标用的路径", () => {
    const one = bashIntentDisplay("rm src/old-file.ts");
    assert.equal(one?.kind, "delete");
    assert.equal(one?.name, "old-file.ts");
    assert.equal(one?.dir, "src");
    assert.equal(one?.path, "src/old-file.ts");
    const same = bashIntentDisplay("rm src/a.ts src/b.ts");
    assert.equal(same?.name, "a.ts +1");
    assert.equal(same?.dir, "src");
    const mixed = bashIntentDisplay("rm src/a.ts lib/b.ts");
    assert.equal(mixed?.dir, "");
    const bare = bashIntentDisplay("rm README.md");
    assert.equal(bare?.name, "README.md");
    assert.equal(bare?.dir, "");
  });
});

describe("compactLabelParts", () => {
  it("bash 按含义拆成列目录、读取、搜索,其余仍算运行命令", () => {
    const parts = compactLabelParts([
      bash("ls src"),
      bash("cat a.ts"),
      bash("cat b.ts c.ts"),
      bash("grep -rn foo ."),
      bash("rg bar"),
      bash("pnpm test"),
      bash("ls packages"),
    ]);
    assert.deepEqual(parts, [
      { kind: "list", count: 2 },
      { kind: "read", count: 3 },
      { kind: "search", count: 2 },
      { kind: "bash", count: 1 },
    ]);
  });

  it("删除文件单独计数,重复删除同一个文件只计一次", () => {
    const parts = compactLabelParts([bash("rm a.ts"), bash("rm -f a.ts b.ts"), bash("ls src")]);
    assert.deepEqual(parts, [
      { kind: "delete", count: 2 },
      { kind: "list", count: 1 },
    ]);
  });

  it("重复读取同一个文件只计一次,并与 read 工具合并", () => {
    const read: ToolTrace = { id: "r1", name: "read", status: "done", activity: { path: "x.ts" } };
    const parts = compactLabelParts([bash("cat a.ts"), bash("cat a.ts"), read]);
    assert.deepEqual(parts, [{ kind: "read", count: 2 }]);
  });
});
