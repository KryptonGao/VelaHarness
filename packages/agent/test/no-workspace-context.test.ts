import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/runtime.ts";
import type { AgentSessionRequest } from "../src/agent-control.ts";

const projectRule = "PROJECT-RULE: release steps for an unrelated repository";
const cwdRule = "CWD-RULE: instructions inside the conversation folder";
const globalRule = "GLOBAL-RULE: user-wide instructions";

/**
 * cwd 位于一个带 AGENTS.md 的“项目”里，agentDir 里另有全局 AGENTS.md。
 * 用脚本化模型跑一轮，取主会话与子代理实际发出的系统提示。
 */
async function prompts(t: TestContext, hasWorkspace: boolean): Promise<{ main: string; child: string }> {
  const root = await mkdtemp(join(tmpdir(), "vela-context-files-"));
  const project = join(root, "project");
  const cwd = join(project, "chats");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir);
  await writeFile(join(project, "AGENTS.md"), projectRule);
  await writeFile(join(cwd, "CLAUDE.md"), cwdRule);
  await writeFile(join(agentDir, "AGENTS.md"), globalRule);
  const runtime = new AgentRuntime({ cwd, agentDir });
  t.after(async () => { runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd, { hasWorkspace });
  const id = runtime.activeConversationId!;
  await runtime.addModel({ providerId: "context-local", providerName: "Context fixture", modelId: "context-model",
    modelName: "Context fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const internals = runtime as unknown as {
    conversations: Map<string, { session: AgentSession }>;
    createChildSession(entry: unknown, input: AgentSessionRequest): Promise<AgentSession>;
  };
  const session = internals.conversations.get(id)!.session;

  async function promptOf(target: AgentSession, run: () => Promise<unknown>): Promise<string> {
    let captured = "";
    const stream: StreamFn = (model) => {
      captured = target.systemPrompt;
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const output = createAssistantMessageEventStream();
      output.push({ type: "start", partial: message });
      output.push({ type: "text_delta", contentIndex: 0, delta: "done", partial: message });
      output.push({ type: "done", reason: "stop", message });
      return output;
    };
    target.agent.streamFunction = stream;
    await run();
    assert.ok(captured, "the scripted model must receive a request");
    return captured;
  }

  const main = await promptOf(session, () => runtime.prompt(id, "context fixture"));
  const childSession = await internals.createChildSession(internals.conversations.get(id), { agentId: "general-fixture",
    parentId: id, parentPath: "/root", parentSession: session, kind: "general", name: "general", path: "/root/general",
    forkMessages: [], customTools: [] });
  t.after(() => childSession.dispose());
  const child = await promptOf(childSession, () => childSession.prompt("child fixture"));
  return { main, child };
}

describe("project context files", () => {
  it("leaves out the folder and ancestor AGENTS.md when the conversation has no workspace", { timeout: 20_000 }, async t => {
    const { main, child } = await prompts(t, false);
    for (const [name, prompt] of Object.entries({ main, child })) {
      assert.equal(prompt.includes(projectRule), false, `${name} skips ancestor context`);
      assert.equal(prompt.includes(cwdRule), false, `${name} skips the folder's own context`);
      assert.ok(prompt.includes(globalRule), `${name} keeps the global context from the data root`);
    }
  });

  it("keeps the workspace and ancestor AGENTS.md for workspace conversations", { timeout: 20_000 }, async t => {
    const { main, child } = await prompts(t, true);
    for (const [name, prompt] of Object.entries({ main, child })) {
      assert.ok(prompt.includes(projectRule), name);
      assert.ok(prompt.includes(cwdRule), name);
      assert.ok(prompt.includes(globalRule), name);
    }
  });
});
