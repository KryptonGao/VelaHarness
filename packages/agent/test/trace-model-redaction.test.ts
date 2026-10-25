import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpConfiguredSecrets, preserveTraceModels, redactMcpDisplay } from "../src/mcp-redaction.ts";

describe("trace model identifiers under MCP redaction", () => {
  const trace = {
    requests: [{ id: "r1", model: "opencode-go/deepseek-v4.1-flash", note: "token code" }],
    summaries: [{ id: "s1", model: "opencode-go/deepseek-v4.1-flash" }],
  };

  it("would be rewritten by plain redaction when a secret is a substring of the model id", () => {
    const secrets = mcpConfiguredSecrets([{ env: { MODE: "code" } }]);
    const masked = redactMcpDisplay(trace, secrets) as typeof trace;
    assert.notEqual(masked.requests[0]!.model, trace.requests[0]!.model);
  });

  it("keeps model ids while still masking other fields", () => {
    const secrets = mcpConfiguredSecrets([{ env: { MODE: "code" } }]);
    const kept = preserveTraceModels(redactMcpDisplay(trace, secrets) as typeof trace, trace);
    assert.equal(kept.requests[0]!.model, "opencode-go/deepseek-v4.1-flash");
    assert.equal(kept.summaries[0]!.model, "opencode-go/deepseek-v4.1-flash");
    assert.equal(kept.requests[0]!.note.includes("code"), false);
  });

  it("leaves snapshots without request lists untouched", () => {
    assert.deepEqual(preserveTraceModels({ version: 1 } as never, { version: 1 } as never), { version: 1 });
  });
});
