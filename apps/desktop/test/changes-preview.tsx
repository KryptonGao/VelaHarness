/** Deterministic browser fixture for the workspace changes review page. Not imported by production. */
import React from "react";
import { createRoot } from "react-dom/client";
import type { GitFileChange, GitRepoInfo, GitStatusSnapshot, VelaApi, WorkspaceFileContent } from "@vela/shared";
import { WorkspaceChangesView } from "../src/renderer/components/WorkspaceChangesView";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import { createMessageStore, messageScope } from "../src/renderer/hooks/message-store";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import "../src/renderer/styles.css";

const README = `# Vela

Vela 是一个 **Agent Trace Viewer**，用来观察 agent 的每一步。

## 工作方式

- \`Agent\` 负责读写与执行
- \`Plan\` 只读查阅并输出计划
- \`Goal\` 记录多步目标

\`\`\`ts
const answer = await agent.run({
  prompt: "hello",
  model: "gpt-5",
});
\`\`\`

| 面板 | 作用 |
| --- | --- |
| 变更 | 审查工作区差异 |
| 轨迹 | 查看工具调用 |

> 引用块

图片：![shot](./assets/shot.png)
`;

const readmeDiff = [
  "diff --git a/README.md b/README.md",
  "index 03ce1a3..1344b9c 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -12,8 +12,9 @@",
  " ## 工作方式",
  " ",
  " -- **按任务选择模式: ** 工作。",
  " -- 新的一行。",
  "++ **按任务选择模式: ** 继续工作。",
  "+",
  "+新增一段说明：顶层目录决定 `Agent` 的文件范围、`Shell` 目录。",
  " - 保留的行",
  " - 最后一行",
].join("\n");

const tsDiff = [
  "diff --git a/apps/desktop/src/index.ts b/apps/desktop/src/index.ts",
  "index 1aa88c4..f2f0d3a 100644",
  "--- a/apps/desktop/src/index.ts",
  "+++ b/apps/desktop/src/index.ts",
  "@@ -1,8 +1,11 @@",
  " import { app } from \"electron\";",
  " ",
  " const template = `",
  "-  old ${app.name}",
  "+  new ${app.name}",
  "+  ${app.getVersion()}",
  " `;",
  " ",
  " // 一段注释",
  "-function start() {",
  "+function start(options: { port: number }) {",
  "+  const { port } = options;",
  "   return port;",
  " }",
  "+",
  "+export const version = app.getVersion();",
].join("\n");

const newFileDiff = [
  "diff --git a/apps/desktop/test/new.test.ts b/apps/desktop/test/new.test.ts",
  "new file mode 100644",
  "index 0000000..3b18e51",
  "--- /dev/null",
  "+++ b/apps/desktop/test/new.test.ts",
  "@@ -0,0 +1,4 @@",
  "+import assert from \"node:assert/strict\";",
  "+",
  "+// 新建文件:整幅显示,不分编辑前后。",
  "+assert.equal(1 + 1, 2);",
].join("\n");

const files: GitFileChange[] = [
  { path: "README.md", oldPath: null, status: "modified", indexStatus: null, worktreeStatus: "modified", addedLines: 2, deletedLines: 1, indexAddedLines: 0, indexDeletedLines: 0, worktreeAddedLines: 2, worktreeDeletedLines: 1 },
  { path: "apps/desktop/src/index.ts", oldPath: null, status: "modified", indexStatus: null, worktreeStatus: "modified", addedLines: 3, deletedLines: 2, indexAddedLines: 0, indexDeletedLines: 0, worktreeAddedLines: 3, worktreeDeletedLines: 2 },
  { path: "apps/desktop/test/new.test.ts", oldPath: null, status: "untracked", indexStatus: null, worktreeStatus: "untracked", addedLines: 4, deletedLines: 0, indexAddedLines: 0, indexDeletedLines: 0, worktreeAddedLines: 4, worktreeDeletedLines: 0 },
];

const repo: GitRepoInfo = { root: "/tmp/vela-fixture", name: "VelaHarness", remoteUrl: null, subdir: null, empty: false };
const git: GitStatusSnapshot = {
  repo,
  branch: "main",
  upstream: null,
  ahead: 0,
  behind: 0,
  detached: false,
  files,
  addedLines: 5,
  deletedLines: 3,
  lastFetchAt: null,
  operation: null,
  identity: { name: "Fixture", email: "fixture@example.com", configured: true },
  remotes: [],
};

const project = {
  git,
  branches: [{ name: "main", current: true }, { name: "feature/menu", current: false }, { name: "origin/main", current: false, remote: true }],
  fileDiff: async (path: string, scope: string) => {
    fixture.calls.push(`${path}:${scope}`);
    if (fixture.failDiff) throw new Error("fixture read failed");
    return path === "README.md" ? scope === "index" ? readmeDiff.replace("继续工作", "已暂存的工作") : readmeDiff : path.endsWith("new.test.ts") ? newFileDiff : tsDiff;
  },
  stageFiles: () => Promise.resolve(true),
  unstageFiles: () => Promise.resolve(true),
  discardFiles: () => Promise.resolve(true),
  openFile: () => Promise.resolve(true),
} as unknown as ProjectApi;

files[0].indexStatus = "modified";
files[0].indexAddedLines = 2;
files[0].indexDeletedLines = 1;
files[1].indexStatus = "modified";
files[1].indexAddedLines = 3;
files[1].indexDeletedLines = 2;
files[1].worktreeStatus = null;
const fixture = { calls: [] as string[], closed: 0, failDiff: false, commitSha: "abc1234", comparison: [] as string[] };
(window as unknown as { changesFixture: typeof fixture }).changesFixture = fixture;
const messageStore = createMessageStore();
messageStore.publish(messageScope("fixture"), [
  { id: "user", role: "user", tools: [] },
  { id: "reply", role: "assistant", tools: [{ id: "edit", name: "edit", status: "done", activity: { path: "last-turn.ts", diff: "-1 old\n+1 new" } }] },
] as unknown as UiMessage[]);
messageStore.flush();

const api = {
  getCommitGraph: async () => ({ commits: [{ sha: "abc1234", shortSha: "abc1234", subject: "Add change filters" }, { sha: "def5678", shortSha: "def5678", subject: "Earlier change" }] }),
  getCommitDetail: async (sha: string) => {
    fixture.commitSha = sha;
    return { files: [{ path: "README.md", addedLines: 2, deletedLines: 1 }], diff: readmeDiff };
  },
  compareRefs: async (base: string, head: string) => {
    fixture.comparison = [base, head];
    return { files: [{ path: "apps/desktop/src/index.ts", addedLines: 3, deletedLines: 2 }], diff: tsDiff, error: null };
  },
  readWorkspaceFile: (path: string): Promise<WorkspaceFileContent> => {
    const content = path === "README.md" ? README : `import { app } from "electron";\n`;
    return Promise.resolve({
      path,
      absolutePath: `/tmp/vela-fixture/${path}`,
      kind: "text",
      content,
      size: content.length,
      truncated: false,
    });
  },
} as unknown as VelaApi;
(window as unknown as { vela: VelaApi }).vela = api;

function Fixture() {
  return (
    <div className="fixture" style={{ height: 640 }}>
      <WorkspaceChangesView project={project} onClose={() => { fixture.closed++; }} messageStore={messageStore} conversationId="fixture" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
