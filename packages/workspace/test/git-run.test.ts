import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, describe, it } from "node:test";
import { gitQueryCapped, runGit } from "../src/git-run.ts";

// 源码内部使用无扩展名导入,node --experimental-strip-types 需要显式扩展名。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // 回退到默认解析
      }
    }
    return nextResolve(specifier, context);
  },
});

const { GitService } = await import("../src/git-service.ts");

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  assert.equal(result.code, 0, `git ${args.join(" ")} 失败: ${result.stderr}`);
  return result.stdout;
}

async function createRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vela-git-run-")));
  tempDirs.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Vela Test"]);
  await git(root, ["config", "user.email", "test@vela.local"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

async function commitFile(root: string, path: string, content: string, message: string): Promise<void> {
  await writeFile(join(root, path), content);
  await git(root, ["add", "--", path]);
  await git(root, ["commit", "-q", "-m", message]);
}

/** 约 bytes 字节的多行文本,每行带序号保证内容各不相同。 */
function bigText(bytes: number, prefix = "line"): string {
  const lines: string[] = [];
  let size = 0;
  for (let index = 0; size < bytes; index++) {
    const line = `${prefix} ${index} ${"x".repeat(60)}\n`;
    lines.push(line);
    size += line.length;
  }
  return lines.join("");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runGit 输出上限", () => {
  it("超过 maxOutputBytes 时截断并标记", async () => {
    const root = await createRepo();
    await commitFile(root, "big.txt", bigText(1024 * 1024), "big");
    const result = await runGit(root, ["show", "HEAD:big.txt"], 15_000, { maxOutputBytes: 10_000 });
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 10_000);
    assert.ok(result.stdout.startsWith("line 0 "));
  });

  it("截断点不切断多字节字符", async () => {
    const root = await createRepo();
    await commitFile(root, "cjk.txt", "差异".repeat(10_000), "cjk");
    // 每个汉字 3 字节,1000 不是 3 的倍数,截断点必须回退到字符边界。
    const result = await runGit(root, ["show", "HEAD:cjk.txt"], 15_000, { maxOutputBytes: 1000 });
    assert.equal(result.truncated, true);
    assert.ok(!result.stdout.includes("�"));
    assert.equal(Buffer.byteLength(result.stdout), 999);
  });

  it("未超限时完整返回,跨块的多字节字符也能正确解码", async () => {
    const root = await createRepo();
    const content = "差异".repeat(100_000);
    await commitFile(root, "cjk.txt", content, "cjk");
    const result = await runGit(root, ["show", "HEAD:cjk.txt"]);
    assert.equal(result.truncated, false);
    assert.equal(result.stdout, content);
  });

  it("gitQueryCapped 截断后只保留完整行", async () => {
    const root = await createRepo();
    await commitFile(root, "big.txt", bigText(200_000), "big");
    const capped = await gitQueryCapped(root, ["show", "HEAD:big.txt"], 5_000);
    assert.equal(capped.truncated, true);
    assert.ok(capped.stdout.endsWith("\n"));
    assert.ok(capped.stdout.length <= 5_000);
    const full = await gitQueryCapped(root, ["show", "HEAD:big.txt"], 1024 * 1024);
    assert.equal(full.truncated, false);
  });
});

describe("runGit 进程与环境", () => {
  it("禁用终端交互提示", async () => {
    const root = await createRepo();
    const stdout = await git(root, ["-c", "alias.envp=!echo \"$GIT_TERMINAL_PROMPT\"", "envp"]);
    assert.equal(stdout.trim(), "0");
  });

  it("超时后连同孙进程一起结束", { skip: process.platform === "win32" }, async () => {
    const root = await createRepo();
    const pidFile = join(root, "sleep.pid");
    await assert.rejects(
      runGit(root, ["-c", `alias.slow=!sleep 30 & echo $! > "${pidFile}"; wait`, "slow"], 500),
      /git 命令超时/,
    );
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    assert.ok(pid > 0);
    for (let attempt = 0; attempt < 20 && isAlive(pid); attempt++) await delay(50);
    assert.equal(isAlive(pid), false);
  });
});

describe("GitService Diff 上限", () => {
  it("fileDiff 对超大改动截断到完整行", async () => {
    const root = await createRepo();
    await commitFile(root, "lock.txt", "seed\n", "seed");
    await writeFile(join(root, "lock.txt"), bigText(3 * 1024 * 1024));
    const service = new GitService();
    try {
      await service.attach(root);
      const diff = await service.fileDiff("lock.txt", "worktree");
      assert.ok(diff.startsWith("diff --git"));
      assert.ok(Buffer.byteLength(diff) <= 2 * 1024 * 1024);
      assert.ok(diff.endsWith("\n"));
    } finally {
      await service.attach(null);
    }
  });

  it("compareRefs 与 commitDetail 标记截断", async () => {
    const root = await createRepo();
    await commitFile(root, "a.txt", "one\n", "first");
    await git(root, ["checkout", "-q", "-b", "feature"]);
    await commitFile(root, "big.txt", bigText(600_000), "big");
    const sha = (await git(root, ["rev-parse", "HEAD"])).trim();
    await git(root, ["checkout", "-q", "main"]);
    const service = new GitService();
    try {
      await service.attach(root);
      const compare = await service.compareRefs("main", "feature");
      assert.equal(compare.error, null);
      assert.equal(compare.diffTruncated, true);
      assert.ok(Buffer.byteLength(compare.diff) <= 400_000);
      assert.equal(compare.files[0]?.path, "big.txt");
      const detail = await service.commitDetail(sha);
      assert.equal(detail.diffTruncated, false);
      assert.match(detail.diff, /^\+line 0 /m);
    } finally {
      await service.attach(null);
    }
  });
});
