import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { isPathInsideReal } from "../../workspace/src/git-service.ts";
import type { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";

let root: string;
let repo: string;
let outside: string;

before(async () => {
  // tmpdir 在 macOS 上本身经过 /var -> /private/var 链接,正好覆盖「边界路径含链接」的情况。
  root = await mkdtemp(join(tmpdir(), "vela-sandbox-tools-"));
  repo = join(root, "repo");
  outside = join(root, "outside");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(repo, "src", "a.ts"), "a");
  await writeFile(join(outside, "id_rsa"), "secret");
  await symlink(outside, join(repo, "link"));
  await symlink(join(outside, "id_rsa"), join(repo, "key"));
  await symlink(join(outside, "missing"), join(repo, "dangling"));
  await symlink(join(repo, "src"), join(repo, "src-alias"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isPathInsideReal", () => {
  it("工作区内的已有文件和尚不存在的路径算工作区内", async () => {
    assert.equal(await isPathInsideReal(join(repo, "src", "a.ts"), repo), true);
    assert.equal(await isPathInsideReal(join(repo, "new", "deep", "b.ts"), repo), true);
    assert.equal(await isPathInsideReal(repo, repo), true);
  });

  it("边界与目标分别用真实路径和链接路径表示时仍判断为工作区内", async () => {
    const realRepo = await realpath(repo);
    assert.equal(await isPathInsideReal(join(realRepo, "src", "a.ts"), repo), true);
    assert.equal(await isPathInsideReal(join(repo, "src", "a.ts"), realRepo), true);
  });

  it("指向工作区内的符号链接仍算工作区内", async () => {
    assert.equal(await isPathInsideReal(join(repo, "src-alias", "a.ts"), repo), true);
  });

  it("经由指向外部的目录链接写入算工作区外", async () => {
    assert.equal(await isPathInsideReal(join(repo, "link", "id_rsa"), repo), false);
    assert.equal(await isPathInsideReal(join(repo, "link", "new", "file"), repo), false);
  });

  it("指向外部文件的链接和悬空链接算工作区外", async () => {
    assert.equal(await isPathInsideReal(join(repo, "key"), repo), false);
    assert.equal(await isPathInsideReal(join(repo, "dangling"), repo), false);
  });

  it("词法上越界或边界不存在时算工作区外", async () => {
    assert.equal(await isPathInsideReal(join(repo, "..", "outside", "id_rsa"), repo), false);
    assert.equal(await isPathInsideReal(join(root, "gone", "a.ts"), join(root, "gone")), false);
  });
});

describe("createSandboxedToolDefinitions 文件写入", () => {
  async function insideFlag(path: string, extraRoots?: readonly string[]): Promise<boolean | undefined> {
    const calls: Array<{ insideWorkspace?: boolean }> = [];
    const permission = {
      request: async (input: { insideWorkspace?: boolean }) => {
        calls.push(input);
        return false;
      },
    } as unknown as SandboxPermissionManager;
    const tools = createSandboxedToolDefinitions({ cwd: repo, workspace: repo, permission, extraRoots: extraRoots ? () => extraRoots : undefined });
    const write = tools.find((tool) => tool.name === "write");
    assert.ok(write);
    await assert.rejects(
      write.execute("call", { path, content: "x" }, undefined, undefined, { cwd: repo } as never),
      /用户拒绝了文件修改/,
    );
    return calls[0]?.insideWorkspace;
  }

  it("经由符号链接写到工作区外时不按工作区内放行", async () => {
    assert.equal(await insideFlag("src/a.ts"), true);
    assert.equal(await insideFlag("link/id_rsa"), false);
    assert.equal(await insideFlag("key"), false);
    assert.deepEqual(await readdir(outside), ["id_rsa"]);
  });

  it("附加文件夹同样按真实路径判断", async () => {
    const extra = join(root, "extra");
    await mkdir(extra, { recursive: true });
    await symlink(outside, join(extra, "link"));
    assert.equal(await insideFlag(join(extra, "notes.md"), [extra]), true);
    assert.equal(await insideFlag(join(extra, "link", "id_rsa"), [extra]), false);
  });
});
