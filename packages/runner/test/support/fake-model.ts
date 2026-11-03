import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FakeReply = string | { toolCalls: { name: string; arguments: Record<string, unknown> }[] } | { status: number; body: string } | { hang: true };

export interface FakeRequest {
  index: number;
  body: { messages: { role: string; content: unknown }[]; [key: string]: unknown };
}

export interface FakeModel {
  url: string;
  requests: FakeRequest[];
  close(): Promise<void>;
}

/**
 * 本地假模型：OpenAI chat-completions 兼容的 SSE 服务。
 * reply 收到第几次请求及其内容，返回文本、工具调用、HTTP 错误或一直挂起。
 */
export async function startFakeModel(reply: (request: FakeRequest) => FakeReply | Promise<FakeReply>): Promise<FakeModel> {
  const requests: FakeRequest[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: FakeRequest["body"];
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { response.writeHead(400).end(); return; }
    const item: FakeRequest = { index: requests.length, body };
    requests.push(item);
    const answer = await reply(item);
    if (typeof answer === "object" && "hang" in answer) return;
    if (typeof answer === "object" && "status" in answer) {
      response.writeHead(answer.status, { "Content-Type": "application/json" }).end(answer.body);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: `fake-${item.index}`, object: "chat.completion.chunk", created: 1, model: "fake-model" };
    const events: unknown[] = [];
    if (typeof answer === "string") {
      events.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] });
      events.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    } else {
      events.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: answer.toolCalls.map((call, index) => ({
        index, id: `call_${item.index}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })) }, finish_reason: null }] });
      events.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    }
    events.push({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
    response.end(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`);
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake model did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

/** 写一个指向假模型的配置目录：自定义提供方 + 默认选择。 */
export async function writeModelConfig(configDir: string, baseUrl: string, options: { select?: boolean; reasoning?: boolean } = {}): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "models.json"), JSON.stringify({
    providers: {
      "fake-local": {
        name: "Fake local",
        baseUrl,
        api: "openai-completions",
        apiKey: "synthetic-test-key",
        models: [{ id: "fake-model", name: "Fake model", api: "openai-completions", reasoning: options.reasoning ?? false, contextWindow: 32768, maxTokens: 4096 }],
      },
    },
  }, null, 2));
  if (options.select !== false) {
    await writeFile(join(configDir, "selection.json"), JSON.stringify({ provider: "fake-local", modelId: "fake-model", thinkingLevel: "off", newConversationSelection: "default", instructions: "" }));
  }
}
