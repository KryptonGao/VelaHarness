import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAction,
  parseUiMessage,
  validateNodeProps,
  type UiArtifact,
  type UiSegment,
} from "@vela/shared";
import { fenced } from "./fixtures/intelligent-ui.ts";

const now = () => 0;

function artifactOf(lines: string[]): UiArtifact {
  const segment = parseUiMessage(fenced(lines), { now }).find((item): item is Extract<UiSegment, { type: "ui" }> => item.type === "ui");
  assert.ok(segment);
  return segment.artifact;
}

const ok = (type: string, props: unknown) => {
  const result = validateNodeProps(type, props);
  assert.ok(result.ok, result.ok ? "" : `${type}: ${result.reason}`);
  return result.value;
};
const bad = (type: string, props: unknown, message?: RegExp) => {
  const result = validateNodeProps(type, props);
  assert.equal(result.ok, false, `${type} should reject ${JSON.stringify(props).slice(0, 120)}`);
  if (!result.ok && message) assert.match(result.reason, message);
};

describe("Intelligent UI charts", () => {
  it("accepts the three data forms and normalizes the shorthand", () => {
    const inline = ok("bar_chart", { title: "Revenue", unit: "k", labels: ["Q1", "Q2"], series: [{ label: "2025", values: [3, null] }, { key: "b", label: "2026", values: [4, 5] }] });
    assert.deepEqual((inline.props.series as Array<{ key: string }>).map(entry => entry.key), ["s1", "b"]);
    const shorthand = ok("line_chart", { data: [{ label: "a", value: 1 }, { label: "b", value: { op: "add", args: [{ ref: "x" }, 1] } }] });
    assert.deepEqual(shorthand.props.labels, ["a", "b"]);
    assert.deepEqual(shorthand.refs, ["x"]);
    const sourced = ok("bar_chart", { from: "stats", x: "name", y: ["count"] });
    assert.deepEqual(sourced.sourceRefs, ["stats"]);
  });

  it("rejects ambiguous, oversized and mismatched data", () => {
    bad("bar_chart", {});
    bad("bar_chart", { labels: ["a"], series: [{ label: "s", values: [1] }], data: [{ label: "a", value: 1 }] }, /exactly one/);
    bad("bar_chart", { labels: ["a", "b"], series: [{ label: "s", values: [1] }] }, /match labels/);
    bad("bar_chart", { labels: Array.from({ length: 101 }, (_, i) => `p${i}`), series: [{ label: "s", values: Array(101).fill(1) }] });
    bad("bar_chart", { labels: ["a"], series: Array.from({ length: 7 }, (_, i) => ({ key: `s${i}`, label: "s", values: [1] })) });
    bad("bar_chart", { labels: ["a"], series: [{ key: "a", label: "x", values: [1] }, { key: "a", label: "y", values: [1] }] });
    bad("line_chart", { data: [{ label: "a", value: "12" }] });
    bad("line_chart", { data: [{ label: "a", value: Number.POSITIVE_INFINITY }] });
    bad("line_chart", { data: [{ label: "a", value: 1 }], yMin: 5, yMax: 5 });
    bad("bar_chart", { from: "s", x: "a", y: [] });
    bad("pie_chart", { slices: [] });
    bad("pie_chart", { slices: Array.from({ length: 25 }, (_, i) => ({ label: `s${i}`, value: 1 })) });
  });

  it("only lets plain number-state references be dragged", () => {
    const draggable = ok("bar_chart", { draggable: true, data: [{ label: "a", value: { ref: "jan" } }, { label: "b", value: 3 }] });
    assert.deepEqual(draggable.bindings, [{ name: "jan", kind: "number" }]);
    bad("bar_chart", { draggable: true, from: "s", x: "a", y: ["b"] }, /inline/);
    const plain = ok("bar_chart", { data: [{ label: "a", value: { ref: "jan" } }] });
    assert.deepEqual(plain.bindings, []);
  });

  it("checks source and binding references when the block is committed", () => {
    const good = artifactOf([
      '{"op":"begin","id":"c","version":1}',
      '{"op":"state","name":"jan","kind":"number","initial":4,"min":0,"max":10}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"chart","parent":"root","type":"bar_chart","props":{"draggable":true,"data":[{"label":"Jan","value":{"ref":"jan"}}]}}',
      '{"op":"commit"}',
    ]);
    assert.equal(good.status, "ready");
    const wrong = artifactOf([
      '{"op":"begin","id":"c","version":1}',
      '{"op":"state","name":"jan","kind":"string","initial":"a"}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"chart","parent":"root","type":"bar_chart","props":{"draggable":true,"data":[{"label":"Jan","value":{"ref":"jan"}}]}}',
      '{"op":"commit"}',
    ]);
    assert.equal(wrong.status, "invalid");
    assert.equal(wrong.reason, "bad_binding");
  });
});

describe("Intelligent UI svg_diagram", () => {
  const diagram = {
    title: "Bicycle", description: "Main parts", width: 400, height: 240, bind: "part",
    shapes: [
      { type: "circle", cx: 80, cy: 160, r: 50, fill: "none", stroke: "accent", strokeWidth: 3 },
      { type: "line", x1: 80, y1: 160, x2: 200, y2: 160 },
      { type: "polygon", points: [[10, 10], [30, 10], [20, 30]], fill: "warning" },
      { type: "path", d: "M 10 10 L 50 50 C 60 60 70 60 80 50 Z" },
      { type: "text", x: 70, y: 230, text: "Wheel", anchor: "middle" },
    ],
    hotspots: [{ id: "wheel", label: "Wheel", description: "Rolls", shape: "circle", cx: 80, cy: 160, r: 50 }],
  };

  it("accepts primitives and hotspots and requires a state to bind", () => {
    const value = ok("svg_diagram", diagram);
    assert.equal((value.props.hotspots as Array<{ value: string }>)[0].value, "wheel");
    assert.deepEqual(value.bindings, [{ name: "part", kind: "string" }]);
    bad("svg_diagram", { ...diagram, bind: undefined }, /hotspots need bind/);
    ok("svg_diagram", { title: "static", shapes: diagram.shapes });
  });

  it("rejects anything outside the safe primitive set", () => {
    for (const type of ["foreignObject", "image", "script", "use", "a", "style", "animate", "g"]) {
      bad("svg_diagram", { title: "x", shapes: [{ type, x: 1 }] }, /unsupported shape/);
    }
    bad("svg_diagram", { title: "x", shapes: [{ type: "path", d: "M0 0 L1 1 <script>" }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "path", d: "L 0 0" }] }, /path commands/);
    bad("svg_diagram", { title: "x", shapes: [{ type: "path", d: "M 0 0 L 1e99 0" }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "path", d: "M 0 0 ".repeat(1000) }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "circle", cx: 99_999, cy: 0, r: 1 }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "circle", cx: 0, cy: 0, r: -1 }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "polygon", points: [[0, 0], [1, 1]] }] });
    bad("svg_diagram", { title: "x", shapes: Array.from({ length: 151 }, () => ({ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 })) });
    bad("svg_diagram", { ...diagram, hotspots: [diagram.hotspots[0], diagram.hotspots[0]] }, /unique/);
  });

  it("only allows named colour tokens and drops event attributes", () => {
    bad("svg_diagram", { title: "x", shapes: [{ type: "rect", x: 0, y: 0, w: 1, h: 1, fill: "#ff0000" }] });
    bad("svg_diagram", { title: "x", shapes: [{ type: "rect", x: 0, y: 0, w: 1, h: 1, fill: "url(javascript:alert(1))" }] });
    const { props } = ok("svg_diagram", { title: "x", shapes: [{ type: "rect", x: 0, y: 0, w: 4, h: 4, onclick: "alert(1)", href: "javascript:1", style: "x" }] });
    const shape = (props.shapes as Array<Record<string, unknown>>)[0];
    assert.equal("onclick" in shape, false);
    assert.equal("href" in shape, false);
    assert.equal("style" in shape, false);
    assert.equal(shape.fill, "surface");
  });
});

describe("Intelligent UI rich views", () => {
  it("validates timeline, itinerary, diff and media", () => {
    ok("timeline", { items: [{ date: "May", title: "Plan", status: "done" }, { title: "Ship" }] });
    ok("timeline", { from: "tasks", titleKey: "name", dateKey: "due" });
    bad("timeline", { items: [{ title: "x", status: "late" }] });
    bad("timeline", { items: [{ date: "x" }] });
    ok("diff_view", { diff: "@@ -1 +1 @@\n-a\n+b", fileName: "a.ts" });
    ok("diff_view", { from: "patch" });
    bad("diff_view", {});
    bad("diff_view", { diff: "x", from: "patch" });
    bad("diff_view", { diff: "x".repeat(40_001) });
    ok("media", { kind: "map", alt: "Route map" });
    bad("media", { kind: "video", alt: "x" });
    bad("media", { kind: "image" });
  });

  it("keeps coordinates only when the model gives both and never invents them", () => {
    const { props } = ok("itinerary", { days: [{ label: "Day 1", stops: [{ name: "Louvre" }, { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 }] }] });
    const stops = (props.days as Array<{ stops: Array<{ lat?: number; lng?: number }> }>)[0].stops;
    assert.equal(stops[0].lat, undefined);
    assert.equal(stops[0].lng, undefined);
    assert.equal(stops[1].lat, 48.8584);
    bad("itinerary", { days: [{ label: "d", stops: [{ name: "x", lat: 10 }] }] }, /go together/);
    bad("itinerary", { days: [{ label: "d", stops: [{ name: "x", lat: 91, lng: 0 }] }] });
    bad("itinerary", { days: [{ label: "d", stops: [{ name: "x", lat: 0, lng: 181 }] }] });
    bad("itinerary", { days: Array.from({ length: 15 }, (_, i) => ({ label: `d${i}`, stops: [] })) });
    bad("itinerary", { days: [{ label: "d", stops: Array.from({ length: 61 }, () => ({ name: "s" })) }] });
  });
});

describe("Intelligent UI data sources and suggested actions", () => {
  it("parses source declarations and checks every from reference on commit", () => {
    const artifact = artifactOf([
      '{"op":"begin","id":"s","version":1}',
      '{"op":"source","name":"files","tool":"bash","match":"git ls-files","format":"lines"}',
      '{"op":"source","name":"total","tool":"bash","call":"call_1","format":"json","path":["stats",0,"count"]}',
      '{"op":"derive","name":"double","expr":{"op":"multiply","args":[{"ref":"total"},2]}}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"n","parent":"root","type":"stat","props":{"label":"Total","from":"total"}}',
      '{"op":"node","id":"t","parent":"root","type":"table","props":{"from":"files","columns":[{"key":"text","label":"File"}]}}',
      '{"op":"commit"}',
    ]);
    assert.equal(artifact.status, "ready");
    assert.deepEqual(artifact.sources.map(source => source.name), ["files", "total"]);
    assert.deepEqual(artifact.sources[1].path, ["stats", 0, "count"]);
    assert.deepEqual(artifact.nodes.find(node => node.id === "n")!.props.value, { ref: "total" });
    const missing = artifactOf([
      '{"op":"begin","id":"s","version":1}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"t","parent":"root","type":"table","props":{"from":"nope","columns":[{"key":"a","label":"A"}]}}',
      '{"op":"commit"}',
    ]);
    assert.equal(missing.reason, "unknown_source");
  });

  it("rejects malformed or hostile source declarations", () => {
    const reason = (source: string) => artifactOf([
      '{"op":"begin","id":"s","version":1}', source, '{"op":"node","id":"root","type":"column","props":{}}', '{"op":"commit"}',
    ]).reason;
    assert.equal(reason('{"op":"source","name":"x","tool":"rm -rf /"}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x","tool":"bash","format":"xml"}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x","tool":"bash","path":["__proto__"]}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x","tool":"bash","path":[-1]}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x","tool":"bash","path":["a","b","c","d","e","f","g","h","i"]}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x","tool":"bash","call":"a b"}'), "bad_source");
    assert.equal(reason('{"op":"source","name":"x y","tool":"bash"}'), "bad_source");
  });

  it("caps the number of sources and shares one name space with state", () => {
    const many = Array.from({ length: 9 }, (_, i) => `{"op":"source","name":"s${i}","tool":"bash"}`);
    assert.equal(artifactOf(['{"op":"begin","id":"s","version":1}', ...many, '{"op":"commit"}']).reason, "limit_sources");
    const clash = artifactOf([
      '{"op":"begin","id":"s","version":1}',
      '{"op":"state","name":"a","kind":"number","initial":1}',
      '{"op":"source","name":"a","tool":"bash"}',
    ]);
    assert.equal(clash.reason, "duplicate_id");
  });

  it("parses refresh_source and request_tool as descriptions only", () => {
    const collector = { refs: new Set<string>(), sourceRefs: new Set<string>() };
    assert.deepEqual(parseAction({ type: "refresh_source", name: "files" }, collector), { type: "refresh_source", name: "files" });
    assert.deepEqual([...collector.sourceRefs], ["files"]);
    const request = parseAction({ type: "request_tool", tool: "bash", summary: "Run the tests", args: { suite: "unit", retries: { ref: "retries" }, fast: true } }, collector);
    assert.equal(request.type, "request_tool");
    assert.ok(collector.refs.has("retries"));
    const throws = (value: unknown) => assert.throws(() => parseAction(value, { refs: new Set(), sourceRefs: new Set() }));
    throws({ type: "request_tool", tool: "bash; rm -rf /", summary: "x" });
    throws({ type: "request_tool", tool: "bash", summary: "" });
    throws({ type: "request_tool", tool: "bash", summary: "x", args: { "a b": 1 } });
    throws({ type: "request_tool", tool: "bash", summary: "x", args: { a: { nested: 1 } } });
    throws({ type: "request_tool", tool: "bash", summary: "x", args: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 1])) });
    throws({ type: "refresh_source", name: "__proto__" });
  });
});
