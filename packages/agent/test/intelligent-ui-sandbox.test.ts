import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SandboxCapabilityBroker,
  UiMetrics,
  UiStreamParser,
  buildSandboxDocument,
  mayContainUi,
  parseSandboxMessage,
  parseUiMessage,
  uiLimits,
  uiSandboxAttribute,
  uiSandboxCsp,
  uiSandboxLimits,
  type UiAppBlock,
  type UiArtifact,
  type UiSegment,
} from "@vela/shared";
import { billSplit, fenced } from "./fixtures/intelligent-ui.ts";

const now = () => 0;
const header = '{"op":"app","id":"snake","version":1,"title":"Snake","height":300}';
const appFence = (lines: string[], fence = "```") => `${fence}vela-app\n${lines.join("\n")}\n${fence}`;

function apps(segments: UiSegment[]): UiAppBlock[] {
  return segments.filter((segment): segment is Extract<UiSegment, { type: "app" }> => segment.type === "app").map(segment => segment.app);
}

describe("vela-app fence parsing", () => {
  const message = `Here it is.\n\n${appFence([header, "<canvas id=c></canvas>", "<script>draw()</script>"])}\n\nEnjoy.`;

  it("keeps Markdown, the app and Markdown in order with the header split from the HTML", () => {
    const segments = parseUiMessage(message, { now });
    assert.deepEqual(segments.map(segment => segment.type), ["markdown", "app", "markdown"]);
    const [app] = apps(segments);
    assert.deepEqual([app.appId, app.title, app.height, app.status], ["snake", "Snake", 300, "ready"]);
    assert.equal(app.source, "<canvas id=c></canvas>\n<script>draw()</script>");
  });

  it("gives identical results for every two-way split", () => {
    const expected = JSON.stringify(parseUiMessage(message, { now }));
    for (let index = 0; index <= message.length; index += 1) {
      const parser = new UiStreamParser({ now });
      parser.feed(message.slice(0, index));
      parser.feed(message.slice(index));
      parser.finish();
      assert.equal(JSON.stringify(parser.segments()), expected, `split at ${index}`);
    }
  });

  it("does not show the fence start while it is still being typed", () => {
    const parser = new UiStreamParser({ now });
    parser.feed("text\n```vela-a");
    assert.deepEqual(parser.segments().map(segment => segment.type), ["markdown"]);
    assert.equal(parser.segments()[0].type === "markdown" && parser.segments()[0].text, "text\n");
    assert.equal(mayContainUi("text\n```vela-a"), true);
    assert.equal(mayContainUi("plain"), false);
  });

  it("reports the app as receiving while it streams and incomplete if it is cut off", () => {
    const parser = new UiStreamParser({ now });
    parser.feed(`${"```"}vela-app\n${header}\n<p>half`);
    assert.equal(apps(parser.segments())[0].status, "receiving");
    parser.feed("\n");
    parser.finish();
    const [app] = apps(parser.segments());
    assert.equal(app.status, "incomplete");
    assert.equal(app.source, "<p>half");
  });

  it("treats a fence without a valid header as an ordinary code block", () => {
    for (const first of ['{"op":"begin","id":"x","version":1}', "<p>no header</p>", '{"op":"app","id":"bad id","version":1}']) {
      const segments = parseUiMessage(appFence([first, "<p>x</p>"]), { now });
      assert.deepEqual(segments.map(segment => segment.type), ["markdown"], first);
      assert.match(segments[0].type === "markdown" ? segments[0].text : "", /vela-app/);
    }
    const example = parseUiMessage(`示例：\n\n\`\`\`\`markdown\n${appFence([header, "<p>x</p>"])}\n\`\`\`\`\n`, { now });
    assert.deepEqual(example.map(segment => segment.type), ["markdown"]);
  });

  it("rejects unsupported versions and oversized sources without keeping the code", () => {
    const [future] = apps(parseUiMessage(appFence(['{"op":"app","id":"a","version":2}', "<p>x</p>"]), { now }));
    assert.deepEqual([future.status, future.reason], ["invalid", "unsupported_version"]);
    const [large] = apps(parseUiMessage(appFence([header, "x".repeat(uiLimits.appBytes + 10)]), { now }));
    assert.deepEqual([large.status, large.reason, large.source], ["invalid", "limit_bytes", ""]);
  });

  it("clamps the container height", () => {
    const height = (value: number | string) => apps(parseUiMessage(appFence([`{"op":"app","id":"a","version":1,"height":${JSON.stringify(value)}}`, "<p>x</p>"]), { now }))[0].height;
    assert.equal(height(5000), 640);
    assert.equal(height(10), 120);
    assert.equal(height("tall"), 320);
  });

  it("keeps vela-ui and vela-app apart and never lets a UI block carry code", () => {
    const message = `${fenced(billSplit)}\n\n${appFence([header, "<p>x</p>"])}`;
    assert.deepEqual(parseUiMessage(message, { now }).map(segment => segment.type), ["ui", "app"]);
    const script = parseUiMessage(fenced([
      '{"op":"begin","id":"x","version":1}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"s","parent":"root","type":"script","props":{"code":"alert(1)"}}',
      '{"op":"node","id":"f","parent":"root","type":"iframe","props":{"srcdoc":"<script>1</script>"}}',
      '{"op":"commit"}',
    ]), { now }).find((segment): segment is Extract<UiSegment, { type: "ui" }> => segment.type === "ui")!.artifact as UiArtifact;
    assert.deepEqual(script.nodes.slice(1).map(node => node.invalid?.slice(0, 11)), ["unsupported", "unsupported"]);
  });

  it("disposes the app source with its message", () => {
    const parser = new UiStreamParser({ now });
    parser.feed(message);
    parser.finish();
    parser.dispose();
    const [app] = apps(parser.segments());
    assert.deepEqual([app.status, app.source], ["disposed", ""]);
  });
});

describe("sandbox document and message bridge", () => {
  it("puts the CSP and bootstrap before any model content and denies the network", () => {
    const document = buildSandboxDocument("<h1>hi</h1><script>evil()</script>");
    assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf("<h1>hi</h1>"));
    assert.ok(document.indexOf("window.vela") < document.indexOf("evil()"));
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "worker-src 'none'"]) {
      assert.ok(uiSandboxCsp.includes(directive), directive);
    }
    assert.equal(/https?:|\*/.test(uiSandboxCsp), false, "no remote or wildcard sources");
    assert.equal(uiSandboxAttribute, "allow-scripts");
    assert.match(document, /RTCPeerConnection/);
  });

  it("accepts only well-formed bridge messages", () => {
    assert.deepEqual(parseSandboxMessage({ vela: 1, type: "ready" }), { type: "ready" });
    assert.deepEqual(parseSandboxMessage({ vela: 1, type: "resize", height: 9999 }), { type: "resize", height: 640 });
    assert.deepEqual(parseSandboxMessage({ vela: 1, type: "error", message: "x".repeat(500) }), { type: "error", message: "x".repeat(200) });
    assert.deepEqual(parseSandboxMessage({ vela: 1, type: "request", id: 3, capability: "agent.submit", text: "hello" }),
      { type: "request", id: 3, capability: "agent.submit", text: "hello" });
    for (const bad of [
      null, "ready", [], { type: "ready" }, { vela: 2, type: "ready" }, { vela: 1, type: "eval", code: "1" },
      { vela: 1, type: "resize", height: Number.NaN }, { vela: 1, type: "resize", height: "300" },
      { vela: 1, type: "request", id: 0, capability: "agent.submit", text: "x" },
      { vela: 1, type: "request", id: 1.5, capability: "agent.submit", text: "x" },
      { vela: 1, type: "request", id: 1, capability: "fs.write", text: "x" },
      { vela: 1, type: "request", id: 1, capability: "agent.submit", text: "" },
      { vela: 1, type: "request", id: 1, capability: "agent.submit", text: "x".repeat(uiSandboxLimits.submitChars + 1) },
      { vela: 1, type: "request", id: 1, capability: "clipboard.write", text: "x".repeat(uiSandboxLimits.clipboardChars + 1) },
    ]) assert.equal(parseSandboxMessage(bad), null, JSON.stringify(bad)?.slice(0, 80));
  });
});

describe("sandbox capability broker", () => {
  const make = () => {
    let clock = 1_000;
    let counter = 0;
    const broker = new SandboxCapabilityBroker({ now: () => clock, token: () => `tok${++counter}` });
    return { broker, advance: (ms: number) => { clock += ms; } };
  };
  const issue = (broker: SandboxCapabilityBroker, app = "c1/u0/a", capability = "agent.submit", size = 10) => {
    const result = broker.issue(app, capability, size);
    assert.ok(result.ok, JSON.stringify(result));
    return result.token;
  };

  it("issues a token that works exactly once", () => {
    const { broker } = make();
    const token = issue(broker);
    assert.deepEqual(broker.redeem(token, "c1/u0/a", "agent.submit", 10), { ok: true });
    assert.deepEqual(broker.redeem(token, "c1/u0/a", "agent.submit", 10), { ok: false, error: "unknown" });
  });

  it("scopes a token to the app, the capability and the approved size", () => {
    const { broker } = make();
    assert.deepEqual(broker.redeem(issue(broker), "other/app", "agent.submit", 10), { ok: false, error: "mismatch" });
    assert.deepEqual(broker.redeem(issue(broker), "c1/u0/a", "clipboard.write", 10), { ok: false, error: "mismatch" });
    assert.deepEqual(broker.redeem(issue(broker), "c1/u0/a", "agent.submit", 11), { ok: false, error: "scope" });
    assert.deepEqual(broker.redeem(issue(broker, "c1/u0/a", "agent.submit", 10), "c1/u0/a", "agent.submit", 4), { ok: true });
  });

  it("expires tokens and revokes them with the app", () => {
    const { broker, advance } = make();
    const old = issue(broker);
    advance(uiSandboxLimits.tokenTtlMs + 1);
    assert.deepEqual(broker.redeem(old, "c1/u0/a", "agent.submit", 1), { ok: false, error: "expired" });
    const revoked = issue(broker);
    const kept = issue(broker, "c1/u1/b");
    assert.equal(broker.revoke("c1/u0/a"), 1);
    assert.deepEqual(broker.redeem(revoked, "c1/u0/a", "agent.submit", 1), { ok: false, error: "unknown" });
    assert.deepEqual(broker.redeem(kept, "c1/u1/b", "agent.submit", 1), { ok: true });
    issue(broker);
    broker.revokeAll();
    assert.equal(broker.outstanding, 0);
  });

  it("limits unused tokens and request frequency per app", () => {
    const { broker, advance } = make();
    for (let index = 0; index < uiSandboxLimits.maxOutstanding; index += 1) issue(broker);
    assert.deepEqual(broker.issue("c1/u0/a", "agent.submit", 1), { ok: false, error: "too_many" });
    // A different app has its own budget.
    issue(broker, "c1/u9/z");
    broker.revoke("c1/u0/a");
    for (let index = uiSandboxLimits.maxOutstanding; index < uiSandboxLimits.requestsPerMinute; index += 1) {
      broker.redeem(issue(broker), "c1/u0/a", "agent.submit", 1);
    }
    assert.deepEqual(broker.issue("c1/u0/a", "agent.submit", 1), { ok: false, error: "rate_limited" });
    advance(61_000);
    assert.ok(broker.issue("c1/u0/a", "agent.submit", 1).ok);
  });

  it("refuses unknown capabilities and sizes outside the limits", () => {
    const { broker } = make();
    assert.deepEqual(broker.issue("a", "fs.read", 1), { ok: false, error: "bad_capability" });
    assert.deepEqual(broker.issue("a", "agent.submit", 0), { ok: false, error: "too_large" });
    assert.deepEqual(broker.issue("a", "agent.submit", uiSandboxLimits.submitChars + 1), { ok: false, error: "too_large" });
    assert.deepEqual(broker.issue("", "agent.submit", 1), { ok: false, error: "bad_capability" });
    assert.deepEqual(broker.redeem("never-issued", "a", "agent.submit", 1), { ok: false, error: "unknown" });
  });
});

describe("Intelligent UI metrics", () => {
  const nodes = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `n${index}`, type: "text", parentId: null, props: {}, childrenIds: [] }));
  const view = (status: UiArtifact["status"], nodeCount: number, reason: UiArtifact["reason"] = null) =>
    ({ status, reason, nodes: nodes(nodeCount), stateDefinitions: [{ name: "a", kind: "number" as const, initial: 1 }] });

  it("counts live outcomes, time to the first valid node and commit rate", () => {
    let clock = 0;
    const metrics = new UiMetrics({ now: () => clock });
    metrics.observe("a", view("receiving", 0), true);
    clock = 120;
    metrics.observe("a", view("receiving", 2), true);
    clock = 300;
    metrics.observe("a", view("ready", 4), true);
    metrics.observe("a", view("ready", 4), true);
    metrics.observe("b", view("receiving", 1), true);
    clock = 400;
    metrics.observe("b", view("invalid", 1, "limit_nodes"), true);
    metrics.observe("c", view("receiving", 3), true);
    clock = 500;
    metrics.observe("c", view("incomplete", 3), true);
    const summary = metrics.summary();
    assert.deepEqual([summary.artifacts, summary.ready, summary.invalid, summary.incomplete], [3, 1, 1, 1]);
    assert.ok(Math.abs((summary.commitRate ?? 0) - 1 / 3) < 1e-9);
    // Samples are measured from first sight: a took 120ms, b and c showed a node immediately.
    assert.equal(summary.medianFirstNodeMs, 0);
    assert.deepEqual(summary.reasons, { limit_nodes: 1, incomplete: 1 });
    assert.equal(summary.averageNodes, (4 + 1 + 3) / 3);
    assert.deepEqual(metrics.timeline("a").map(event => event.type), ["begin", "first_node", "ready"]);
    assert.deepEqual(metrics.timeline("b").map(event => [event.type, event.detail]), [["begin", undefined], ["first_node", undefined], ["invalid", "limit_nodes"]]);
  });

  it("does not let history restores inflate the outcome statistics", () => {
    const metrics = new UiMetrics({ now: () => 0 });
    metrics.observe("old", view("ready", 5), false);
    assert.equal(metrics.summary().artifacts, 0);
    assert.equal(metrics.summary().commitRate, null);
    assert.equal(metrics.summary().medianFirstNodeMs, null);
  });

  it("tracks the share of replies with an interface once per reply", () => {
    const metrics = new UiMetrics();
    metrics.assistantMessage("m1", true);
    metrics.assistantMessage("m1", true);
    metrics.assistantMessage("m2", false);
    metrics.assistantMessage("m3", false);
    metrics.assistantMessage("m4", false);
    assert.deepEqual([metrics.summary().assistantMessages, metrics.summary().uiMessages, metrics.summary().uiRatio], [4, 1, 0.25]);
  });

  it("records render errors and micro-app lifecycle reasons", () => {
    const metrics = new UiMetrics({ now: () => 0 });
    metrics.renderError("a");
    metrics.appRun("app1");
    metrics.appStop("app1", "unresponsive");
    metrics.appStop("app1", "stopped");
    metrics.appBlocked("app2", "disabled");
    metrics.appBlocked("app2", "disabled");
    const summary = metrics.summary();
    assert.equal(summary.renderErrors, 1);
    assert.equal(summary.appRuns, 1);
    assert.deepEqual(summary.appStops, { unresponsive: 1, stopped: 1 });
    assert.deepEqual(summary.reasons, { render_error: 1, app_unresponsive: 1, app_blocked: 1 });
  });

  it("persists only aggregate counters and survives corrupt storage", () => {
    const metrics = new UiMetrics({ now: () => 0 });
    metrics.assistantMessage("secret-message-id", true);
    metrics.observe("secret-artifact-key", view("ready", 2), true);
    const raw = metrics.serialize();
    assert.equal(raw.includes("secret"), false);
    const restored = new UiMetrics();
    restored.restore(raw);
    assert.deepEqual(restored.summary(), metrics.summary());
    for (const bad of ["", "{", "[]", '{"v":9}', '{"v":1,"ready":-4,"reasons":{"__proto__":3,"ok":"x"},"firstNodeSamples":["a",5]}']) {
      const target = new UiMetrics();
      target.restore(bad);
      const summary = target.summary();
      assert.ok(summary.ready >= 0 && Object.getPrototypeOf(summary.reasons) === Object.prototype);
      assert.equal(Object.prototype.hasOwnProperty.call(summary.reasons, "__proto__"), false);
    }
    restored.reset();
    assert.equal(restored.summary().artifacts, 0);
  });

  it("notifies subscribers on change", () => {
    const metrics = new UiMetrics();
    let calls = 0;
    const stop = metrics.subscribe(() => { calls += 1; });
    metrics.renderError("a");
    stop();
    metrics.renderError("a");
    assert.equal(calls, 1);
  });
});
