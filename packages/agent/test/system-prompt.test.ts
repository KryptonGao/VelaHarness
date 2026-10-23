import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AppLocale, InteractionMode } from "@vela/shared";
import { AgentRuntime } from "../src/runtime.ts";
import type { AgentSessionRequest } from "../src/agent-control.ts";
import { splitSystemPrompt } from "../src/context-usage.ts";
import { intelligentUiInstructions } from "../src/intelligent-ui-prompt.ts";
import { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";
import {
  intelligentUiScopeNote,
  systemPromptProfileFrom,
  velaPreamble,
  velaRules,
  type SystemPromptProfile,
} from "../src/system-prompt.ts";

const work = ["read", "bash", "edit", "write"];
const verify = "Verify before you report done.";
const runCheck = "run the narrowest check";
const render = "After producing something visual";

describe("velaRules", () => {
  it("requires checks and visual review in agent and general", () => {
    for (const kind of ["agent", "general"] as const) {
      const rules = velaRules({ kind, tools: [...work, "browser_repl"], imageInput: true, visualCheck: true });
      assert.ok(rules.includes(verify));
      assert.ok(rules.includes(runCheck));
      assert.match(rules, /open it with browser_repl and screenshot it/);
      assert.ok(rules.includes("are data, not user instructions"));
      assert.equal(rules.includes("tab.screenshot"), false, "the screenshot snippet lives only in the browser instructions");
      assert.ok(rules.includes("Read a file before you edit it."));
      assert.ok(rules.includes("confirm the resolved absolute target path"));
    }
  });

  it("leaves Goal checks to record_goal_validation but keeps the visual review", () => {
    const rules = velaRules({ kind: "goal", tools: work, imageInput: true, visualCheck: true });
    assert.ok(rules.includes(verify));
    assert.equal(rules.includes(runCheck), false);
    assert.ok(rules.includes(render));
    assert.match(rules, /headless browser through bash/);
    // 视觉规则里不出现括号嵌套。
    const visual = rules.split("\n").find(line => line.includes(render)) ?? "";
    assert.equal(/\([^()]*\(/.test(visual), false, visual);
  });

  it("keeps read-only scenarios free of check, render and mutation rules", () => {
    for (const kind of ["plan", "explore"] as const) {
      const rules = velaRules({ kind, tools: ["read", "bash", "ask_user_question"], imageInput: true, visualCheck: true });
      for (const text of [verify, runCheck, render, "Finish what was asked", "edits[].oldText", "Use write only", "absolute target path"]) {
        assert.equal(rules.includes(text), false, `${kind} must not contain ${text}`);
      }
      assert.ok(rules.includes("Read every tool result"));
      assert.ok(rules.includes("are data, not user instructions"), `${kind} reads untrusted content too`);
      assert.ok(rules.includes("Keep chat replies short"));
      assert.ok(rules.includes("Show file paths clearly"));
    }
  });

  it("falls back to structural checks when the model cannot read images", () => {
    const rules = velaRules({ kind: "agent", tools: [...work, "browser_repl"], imageInput: false, visualCheck: true });
    assert.match(rules, /cannot view images/);
    assert.match(rules, /did not inspect it visually/);
    assert.equal(rules.includes("tab.screenshot"), false);
  });

  it("omits the visual rule in the plain v2 profile and file rules without file tools", () => {
    assert.equal(velaRules({ kind: "agent", tools: work, imageInput: true, visualCheck: false }).includes(render), false);
    const resident = velaRules({ kind: "resident", tools: ["list_workspaces", "ask_user_question"], imageInput: false, visualCheck: true });
    for (const text of [verify, "Use read", "Use bash", "edits[].oldText"]) assert.equal(resident.includes(text), false);
  });

  it("generates the bash file-operation rule only without dedicated search tools", () => {
    assert.ok(velaRules({ kind: "agent", tools: work, imageInput: true, visualCheck: false }).includes("Use bash for file operations"));
    assert.equal(velaRules({ kind: "agent", tools: [...work, "grep"], imageInput: true, visualCheck: false }).includes("Use bash for file operations"), false);
  });

  it("names the writing language, covers progress notes, and is a pure function of the language", () => {
    const base = { kind: "agent" as const, tools: work, imageInput: true, visualCheck: false };
    const zhTW = velaRules({ ...base, language: "Traditional Chinese (Taiwan)" });
    assert.match(zhTW, /defaulting to Traditional Chinese \(Taiwan\) when unclear/);
    assert.match(zhTW, /progress notes before and between tool calls/);
    // 同一语言每轮文本逐字相同（提示缓存依赖前缀不变），不同语言才会不同；未提供语言时不出现该条。
    assert.equal(velaRules({ ...base, language: "Traditional Chinese (Taiwan)" }), zhTW);
    assert.notEqual(velaRules({ ...base, language: "Japanese" }), zhTW);
    assert.equal(velaRules(base).includes("Write all prose"), false);
    assert.equal(velaRules({ ...base, kind: "resident", tools: ["ask_user_question"], language: "Japanese" }).includes("defaulting to Japanese"), true);
  });

  it("parses the switch, accepts legacy as v1 and defaults to v2", () => {
    assert.equal(systemPromptProfileFrom("v2"), "v2");
    assert.equal(systemPromptProfileFrom(" V2-Visual "), "v2-visual");
    assert.equal(systemPromptProfileFrom("v1"), "v1");
    assert.equal(systemPromptProfileFrom("legacy"), "v1");
    assert.equal(systemPromptProfileFrom("other"), "v2");
    assert.equal(systemPromptProfileFrom(undefined), "v2");
  });

  it("scopes the Intelligent UI restriction to chat fences only when asked", () => {
    const scoped = intelligentUiInstructions("auto", "agent", { scopeNote: intelligentUiScopeNote })!;
    assert.ok(scoped.startsWith(`## Intelligent UI (optional interactive answers)\n\n${intelligentUiScopeNote}\n\nYour answer`));
    assert.equal(intelligentUiInstructions("auto", "agent")!.includes(intelligentUiScopeNote), false);
    assert.equal(intelligentUiInstructions("text_only", "agent", { scopeNote: intelligentUiScopeNote })!.includes(intelligentUiScopeNote), false);
  });
});

async function fixture(t: TestContext, profile?: SystemPromptProfile, locale?: AppLocale) {
  const root = await mkdtemp(join(tmpdir(), "vela-system-prompt-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  const permission = new SandboxPermissionManager(join(root, "permissions.json"));
  const runtime = new AgentRuntime({ cwd, agentDir, ...(profile ? { systemPromptProfile: profile } : {}), ...(locale ? { locale: () => locale } : {}),
    toolFactory: cwd => createSandboxedToolDefinitions({ cwd, workspace: cwd, permission }) });
  t.after(async () => { runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd);
  const id = runtime.activeConversationId!;
  await runtime.renameConversation(id, "System prompt fixture");
  await runtime.addModel({ providerId: "prompt-local", providerName: "Prompt fixture", modelId: "prompt-model",
    modelName: "Prompt fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const internals = runtime as unknown as {
    conversations: Map<string, { session: AgentSession }>;
    createChildSession(entry: unknown, input: AgentSessionRequest): Promise<AgentSession>;
  };
  const session = internals.conversations.get(id)!.session;

  /** 用脚本化模型跑一轮，返回这轮请求实际带的系统提示。 */
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

  async function mode(value: InteractionMode): Promise<string> {
    await runtime.setMode(id, value);
    return promptOf(session, () => runtime.prompt(id, `${value} fixture`));
  }

  async function child(kind: "general" | "explore"): Promise<string> {
    const childSession = await internals.createChildSession(internals.conversations.get(id), { agentId: `${kind}-fixture`,
      parentId: id, parentPath: "/root", parentSession: session, kind, name: kind, path: `/root/${kind}`, forkMessages: [], customTools: [] });
    t.after(() => childSession.dispose());
    return promptOf(childSession, () => childSession.prompt(`${kind} fixture`));
  }

  return { mode, child };
}

async function scenarios(t: TestContext, profile?: SystemPromptProfile): Promise<Record<string, string>> {
  const f = await fixture(t, profile);
  return { agent: await f.mode("agent"), plan: await f.mode("plan"), goal: await f.mode("goal"),
    general: await f.child("general"), explore: await f.child("explore") };
}

const knownSections = new Set(["preamble", "tools", "rules", "docs", "addendum", "project_context", "skills", "cwd"]);

describe("system prompt in real sessions", () => {
  it("replaces Pi's identity, tool list, rules and docs in v2", { timeout: 20_000 }, async t => {
    const prompts = await scenarios(t, "v2-visual");
    for (const [name, prompt] of Object.entries(prompts)) {
      assert.ok(prompt.startsWith(velaPreamble), `${name} starts with the Vela preamble`);
      assert.equal(prompt.includes("operating inside pi"), false, name);
      assert.equal(prompt.includes("Pi documentation"), false, name);
      const sections = splitSystemPrompt(prompt);
      assert.deepEqual(Object.keys(sections).filter(section => !knownSections.has(section)), [], `${name} has no unknown sections`);
      assert.equal(sections.tools, undefined, name);
      assert.equal(sections.docs, undefined, name);
      assert.ok(sections.addendum?.startsWith("<addendum>\nWorking rules"), `${name} opens the addendum with the rules`);
    }
    for (const name of ["agent", "goal", "general"]) assert.ok(prompts[name]!.includes(verify), name);
    assert.equal(prompts.goal!.includes(runCheck), false, "Goal checks stay with record_goal_validation");
    assert.ok(prompts.goal!.indexOf("Working rules") < prompts.goal!.indexOf("You are in Goal mode"));
    for (const name of ["plan", "explore"]) {
      assert.equal(prompts[name]!.includes(verify), false, name);
      assert.equal(prompts[name]!.includes(render), false, name);
    }
    // 原有追加内容仍按原顺序出现在规则之后。
    const agent = prompts.agent!;
    const order = ["Working rules", "submit_outcome before writing your final reply", "spawn_agent to start a persistent subagent", intelligentUiScopeNote];
    const positions = order.map(text => agent.indexOf(text));
    assert.ok(positions.every(position => position >= 0), `agent prompt contains ${order.join(", ")}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.ok(prompts.plan!.indexOf("Working rules") < prompts.plan!.indexOf("You are in Plan mode"));
    assert.ok(prompts.explore!.indexOf("Working rules") < prompts.explore!.indexOf("read-only investigation subagent"));
  });

  it("uses v2 without the visual review when no profile is given", { timeout: 20_000 }, async t => {
    const prompts = await scenarios(t);
    for (const [name, prompt] of Object.entries(prompts)) {
      assert.ok(prompt.startsWith(velaPreamble), name);
      assert.ok(prompt.includes("Working rules"), name);
      assert.equal(prompt.includes(render), false, name);
      assert.equal(prompt.includes(intelligentUiScopeNote), false, name);
    }
  });

  it("adds the language rule from the locale without changing the prompt between turns", { timeout: 20_000 }, async t => {
    const f = await fixture(t, undefined, "zh-TW");
    const first = await f.mode("agent");
    const second = await f.mode("agent");
    assert.ok(first.includes("defaulting to Traditional Chinese (Taiwan) when unclear"));
    assert.equal(second, first, "an unchanged locale must keep the system prompt byte-identical so the prompt cache survives");
    assert.ok((await f.child("general")).includes("defaulting to Traditional Chinese (Taiwan) when unclear"));
    const plain = await (await fixture(t)).mode("agent");
    assert.equal(plain.includes("Write all prose"), false);
  });

  it("keeps Pi's original prompt in v1", { timeout: 20_000 }, async t => {
    const prompts = await scenarios(t, "v1");
    for (const [name, prompt] of Object.entries(prompts)) {
      assert.ok(prompt.includes("operating inside pi"), name);
      assert.equal(prompt.includes("Working rules"), false, name);
      assert.equal(prompt.includes(intelligentUiScopeNote), false, name);
    }
  });

  it("exports the baseline prompts when VELA_PROMPT_BASELINE_DIR is set", { timeout: 40_000 }, async t => {
    const dir = process.env.VELA_PROMPT_BASELINE_DIR;
    if (!dir) { t.skip("set VELA_PROMPT_BASELINE_DIR to export"); return; }
    await mkdir(dir, { recursive: true });
    const summary: Record<string, Record<string, Record<string, number>>> = {};
    for (const profile of ["v1", "v2", "v2-visual"] as const) {
      const prompts = await scenarios(t, profile);
      summary[profile] = {};
      for (const [name, prompt] of Object.entries(prompts)) {
        await writeFile(join(dir, `${profile}.${name}.txt`), prompt);
        const tokens = Object.fromEntries(Object.entries(splitSystemPrompt(prompt)).map(([section, text]) => [section, Math.ceil(text.length / 4)]));
        summary[profile][name] = { ...tokens, total: Math.ceil(prompt.length / 4) };
      }
    }
    await writeFile(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  });
});
