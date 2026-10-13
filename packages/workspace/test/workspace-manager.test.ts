import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { WorkspaceManager } from "../src/workspace-manager.ts";

const tempDirs: string[] = [];
const maxWorkspaceFolders = 10;

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function fixture(...names: string[]): Promise<{ store: string; dirs: string[] }> {
  const root = await mkdtemp(join(tmpdir(), "vela-workspace-"));
  tempDirs.push(root);
  const dirs: string[] = [];
  for (const name of names) {
    const dir = join(root, name);
    await mkdir(dir);
    dirs.push(dir);
  }
  return { store: join(root, "state", "workspaces.json"), dirs };
}

describe("WorkspaceManager 多文件夹", () => {
  it("附加文件夹随主要文件夹保存,重启后恢复", async () => {
    const { store, dirs } = await fixture("app", "docs");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    const state = await manager.update({ path: dirs[0], name: null, folders: [dirs[0], dirs[1]] });
    assert.deepEqual(state.folders, [dirs[1]]);
    assert.deepEqual(manager.foldersOf(dirs[0]), [dirs[1]]);

    const restored = await new WorkspaceManager(store).init();
    assert.equal(restored.current, dirs[0]);
    assert.deepEqual(restored.folders, [dirs[1]]);
  });

  it("重新选择同一工作区不会丢失附加文件夹或名称,切换工作区则各自独立", async () => {
    const { store, dirs } = await fixture("app", "docs", "other");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    await manager.update({ path: dirs[0], name: "My App", folders: [dirs[0], dirs[1]] });
    const other = await manager.select(dirs[2]);
    assert.deepEqual(other.folders, []);
    const back = await manager.select(dirs[0]);
    assert.deepEqual(back.folders, [dirs[1]]);
    assert.equal(back.recents.find((recent) => recent.path === dirs[0])?.displayName, "My App");
  });

  it("可以编辑不是当前工作区的工作区,当前工作区不受影响", async () => {
    const { store, dirs } = await fixture("app", "docs", "other");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    await manager.select(dirs[2]);
    const state = await manager.update({ path: dirs[0], name: null, folders: [dirs[0], dirs[1]] });
    assert.equal(state.current, dirs[2]);
    assert.deepEqual(state.folders, []);
    assert.deepEqual(manager.foldersOf(dirs[0]), [dirs[1]]);
  });

  it("拒绝空列表、重复路径、不存在的目录和超出数量上限", async () => {
    const { store, dirs } = await fixture("app", "docs");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    await assert.rejects(() => manager.update({ path: dirs[0], name: null, folders: [] }), /至少需要一个文件夹/);
    await assert.rejects(() => manager.update({ path: dirs[0], name: null, folders: [dirs[0], join(dirs[0], "missing")] }), /目录不存在/);
    const deduped = await manager.update({ path: dirs[0], name: null, folders: [dirs[0], `${dirs[1]}/`, dirs[1], dirs[0]] });
    assert.deepEqual(deduped.folders, [dirs[1]]);

    const { store: crowdedStore, dirs: crowded } = await fixture(
      "main", ...Array.from({ length: maxWorkspaceFolders + 1 }, (_, index) => `extra-${index}`),
    );
    const full = new WorkspaceManager(crowdedStore);
    await full.init();
    await full.select(crowded[0]);
    await assert.rejects(() => full.update({ path: crowded[0], name: null, folders: crowded }), /数量已达上限/);
    const ok = await full.update({ path: crowded[0], name: null, folders: crowded.slice(0, maxWorkspaceFolders + 1) });
    assert.equal(ok.folders.length, maxWorkspaceFolders);
  });

  it("把另一个文件夹排到第一位即改主要:当前工作区跟着切换,原主要文件夹降为附加", async () => {
    const { store, dirs } = await fixture("app", "docs", "assets");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    await manager.update({ path: dirs[0], name: null, folders: [dirs[0], dirs[1], dirs[2]] });
    const events: string[] = [];
    manager.subscribe((state) => events.push(state.current ?? ""));

    const state = await manager.update({ path: dirs[0], name: null, folders: [dirs[1], dirs[0], dirs[2]] });
    assert.equal(state.current, dirs[1]);
    assert.deepEqual(state.folders, [dirs[0], dirs[2]]);
    assert.deepEqual(events, [dirs[1]]);
    assert.equal(state.recents.length, 1, "旧主要文件夹的记录并入新工作区,不再单独出现");
    // 以旧主要文件夹为目录的会话仍能看到同一工作区的其余文件夹。
    assert.deepEqual(manager.foldersOf(dirs[0]), [dirs[1], dirs[2]]);
  });

  it("名称与主要文件夹同名时恢复默认,空名称清除自定义名", async () => {
    const { store, dirs } = await fixture("app");
    const manager = new WorkspaceManager(store);
    await manager.init();
    await manager.select(dirs[0]);
    const named = await manager.update({ path: dirs[0], name: "  Pretty   name ", folders: [dirs[0]] });
    assert.equal(named.recents[0].displayName, "Pretty name");
    const reset = await manager.update({ path: dirs[0], name: "app", folders: [dirs[0]] });
    assert.equal(reset.recents[0].displayName, undefined);
  });

  it("读取旧版存储(没有 folders 字段)时按空列表处理", async () => {
    const { store, dirs } = await fixture("app");
    const first = new WorkspaceManager(store);
    await first.init();
    await first.select(dirs[0]);
    await writeFile(store, JSON.stringify({ current: dirs[0], recents: [{ path: dirs[0], name: "app", lastUsedAt: 1 }] }), "utf8");
    const restored = await new WorkspaceManager(store).init();
    assert.deepEqual(restored.folders, []);
    assert.deepEqual(restored.recents[0].folders, []);
  });
});
