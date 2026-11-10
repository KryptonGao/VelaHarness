import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marketplaceLimits, parseMarketplaceCatalog, parseMarketplaceManifest } from "../../../packages/shared/src/marketplace-protocol.ts";
import { assembleCatalog, assembleSkill, assertServablePath, findSkillDirectory, renderBuiltinCatalog, sha256Hex, type SourceEntry } from "../scripts/build-lib.ts";

const enc = new TextEncoder();
const entry: SourceEntry = { id: "docx", source: "anthropics/skills", skill: "docx", category: "office", commit: "b".repeat(40) };
const file = (path: string, text = "x") => ({ path, bytes: enc.encode(text) });

describe("findSkillDirectory", () => {
  it("finds nested folders and prefers the shallowest visible one", () => {
    assert.equal(findSkillDirectory(["skills/a/SKILL.md", ".claude/skills/a/SKILL.md"], "a"), "skills/a");
    assert.equal(findSkillDirectory(["skills/x/y/a/SKILL.md", "skills/a/SKILL.md"], "a"), "skills/a");
    assert.equal(findSkillDirectory(["skills/b/SKILL.md"], "a"), null);
    assert.equal(findSkillDirectory(["skills/a/readme.md"], "a"), null);
  });
});

describe("assembleSkill", () => {
  it("lists files sorted with size and sha256, and builds deterministic bytes", () => {
    const first = assembleSkill(entry, "skills/docx", [file("scripts/run.py", "print(1)"), file("SKILL.md", "hi")]);
    const second = assembleSkill(entry, "skills/docx", [file("SKILL.md", "hi"), file("scripts/run.py", "print(1)")]);
    assert.deepEqual(first.manifest.files.map((item) => item.path), ["SKILL.md", "scripts/run.py"]);
    assert.equal(first.manifest.files[0]?.sha256, sha256Hex(enc.encode("hi")));
    assert.equal(first.manifest.files[1]?.size, 8);
    assert.deepEqual(first.manifestBytes, second.manifestBytes);
    assert.equal(first.manifest.version, "bbbbbbb");
    assert.deepEqual(parseMarketplaceManifest(new TextDecoder().decode(first.manifestBytes)), first.manifest);
  });

  it("fails at build time for skills the client would refuse", () => {
    assert.throws(() => assembleSkill(entry, "p", [file("readme.md")]), /缺少 SKILL\.md/);
    const many = [file("SKILL.md"), ...Array.from({ length: marketplaceLimits.maxFiles }, (_, index) => file(`f/${index}.txt`))];
    assert.throws(() => assembleSkill(entry, "p", many), /文件数/);
    const big = { path: "big.bin", bytes: new Uint8Array(marketplaceLimits.maxFileBytes + 1) };
    assert.throws(() => assembleSkill(entry, "p", [file("SKILL.md"), big]), /单文件上限/);
  });

  it("refuses paths that static hosting would rewrite or drop", () => {
    for (const bad of ["a b.md", "a#b.md", "a?b.md", "a%20b.md", "../x", "/x", ".DS_Store", "dir/.git/config", "node_modules/x.js", "é.md"]) {
      assert.throws(() => assertServablePath(bad), /无法分发/, bad);
    }
    for (const good of ["SKILL.md", "scripts/office/validators/base.py", ".gitignore", "a-b_c.d@2x.png"]) assertServablePath(good);
  });
});

describe("assembleCatalog", () => {
  it("pins every manifest by hash and round-trips through the parser", () => {
    const built = assembleSkill(entry, "skills/docx", [file("SKILL.md", "hi")]);
    const { catalog, bytes } = assembleCatalog([built]);
    assert.equal(catalog.skills[0]?.manifestSha256, sha256Hex(built.manifestBytes));
    assert.equal(catalog.skills[0]?.commit, entry.commit);
    assert.equal(catalog.skills[0]?.fileCount, 1);
    assert.deepEqual(parseMarketplaceCatalog(new TextDecoder().decode(bytes)), catalog);
  });
});

describe("protocol parsing", () => {
  const good = { schema: 1, skills: [] as unknown[] };
  const row = { id: "a", source: "o/r", skill: "a", category: "agent", version: "v", commit: "c".repeat(40), manifestSha256: "d".repeat(64), fileCount: 1, totalBytes: 1 };

  it("rejects malformed catalogs", () => {
    const parse = (value: unknown) => parseMarketplaceCatalog(JSON.stringify(value));
    assert.deepEqual(parse(good).skills, []);
    assert.throws(() => parse({ ...good, schema: 2 }));
    assert.throws(() => parse({ ...good, skills: [row, row] }), /重复/);
    assert.throws(() => parse({ ...good, skills: [{ ...row, category: "nope" }] }));
    assert.throws(() => parse({ ...good, skills: [{ ...row, id: "../x" }] }));
    assert.throws(() => parse({ ...good, skills: [{ ...row, commit: "short" }] }));
    assert.throws(() => parse({ ...good, skills: [{ ...row, source: "not a repo" }] }));
  });

  it("rejects manifests with unsafe or case-colliding paths", () => {
    const base = { schema: 1, id: "a", skill: "a", version: "v", source: "o/r", commit: "c".repeat(40), upstreamPath: "p" };
    const sha = "e".repeat(64);
    const parse = (files: unknown[]) => parseMarketplaceManifest(JSON.stringify({ ...base, files }));
    assert.equal(parse([{ path: "SKILL.md", size: 1, sha256: sha }]).files.length, 1);
    assert.throws(() => parse([{ path: "a/../b", size: 1, sha256: sha }]), /不安全/);
    assert.throws(() => parse([{ path: "a//b", size: 1, sha256: sha }]), /不安全/);
    assert.throws(() => parse([{ path: "A.md", size: 1, sha256: sha }, { path: "a.md", size: 1, sha256: sha }]), /重复/);
    assert.throws(() => parse([{ path: "x", size: -1, sha256: sha }]));
    assert.throws(() => parse([{ path: "x", size: 1, sha256: "zz" }]));
  });
});

describe("renderBuiltinCatalog", () => {
  it("renders optional fields only when present", () => {
    const text = renderBuiltinCatalog([
      { id: "a", source: "o/r", skill: "a", category: "agent" },
      { id: "b", source: "o/r", skill: "b", dir: "bb", category: "docs", description: "d", mcp: [{ name: "n", description: "m" }] },
    ]);
    assert.match(text, /\{ id: "a", source: "o\/r", skill: "a", category: "agent" \},/);
    assert.match(text, /dir: "bb", category: "docs", description: "d", mcp: \[\{"name":"n","description":"m"\}\]/);
    assert.match(text, /请勿手改/);
  });
});
