import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { marketplaceLimits, marketplaceSkills } from "@vela/shared";
import {
  assembleCatalog,
  assembleSkill,
  sha256Hex,
  signBytes,
  type BuiltSkill,
  type SourceEntry,
} from "../../../services/skill-market/scripts/build-lib.ts";
import { loadSkillCatalog } from "../src/skill-catalog.ts";
import { installMarketplaceSkill, loadMarketplaceListing } from "../src/skill-marketplace.ts";

const base = "https://market.test";
const commit = "a".repeat(40);
const skillMd = "---\nname: docx\ndescription: Word documents\n---\nBody\n";
const enc = new TextEncoder();

interface KeyPair {
  privateKey: KeyObject;
  raw: string;
}

function keyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, raw: spki.subarray(spki.length - 32).toString("base64") };
}

const trusted = keyPair();

function entry(id: string, skill = id): SourceEntry {
  return { id, source: "anthropics/skills", skill, category: "office", commit };
}

function build(id: string, files: Record<string, string>, skill = id): BuiltSkill {
  return assembleSkill(
    entry(id, skill),
    `skills/${skill}`,
    Object.entries(files).map(([path, text]) => ({ path, bytes: enc.encode(text) })),
  );
}

/** 一个内存里的市场服务：按路径返回字节，测试可以在建好之后改动其中任何一项。 */
class FakeMarket {
  readonly assets = new Map<string, Uint8Array>();
  readonly requests: string[] = [];
  down = false;
  failures = new Map<string, number>();

  constructor(readonly key: KeyPair = trusted) {}

  publish(skills: BuiltSkill[], options: { catalog?: boolean } = {}): void {
    for (const built of skills) {
      const dir = `/v1/skills/${built.entry.id}`;
      this.assets.set(`${dir}/manifest.json`, built.manifestBytes);
      this.assets.set(`${dir}/manifest.json.sig`, enc.encode(signBytes(built.manifestBytes, this.key.privateKey)));
      for (const file of built.files) this.assets.set(`${dir}/files/${file.path}`, file.bytes);
    }
    if (options.catalog !== false) {
      const { bytes } = assembleCatalog(skills);
      this.assets.set("/v1/catalog.json", bytes);
      this.assets.set("/v1/catalog.json.sig", enc.encode(signBytes(bytes, this.key.privateKey)));
    }
  }

  readonly fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    this.requests.push(url.pathname);
    if (this.down) throw new TypeError("fetch failed");
    const remaining = this.failures.get(url.pathname) ?? 0;
    if (remaining > 0) {
      this.failures.set(url.pathname, remaining - 1);
      throw new TypeError("fetch failed");
    }
    const bytes = this.assets.get(decodeURIComponent(url.pathname));
    return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
  }) as typeof fetch;

  options(extra: { publicKeys?: string[] } = {}) {
    return { fetch: this.fetch, baseUrl: base, publicKeys: extra.publicKeys ?? [trusted.raw] };
  }
}

async function withRoot<T>(run: (root: string, agentDir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "vela-market-"));
  try {
    return await run(root, join(root, ".vela"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function skillsDirEntries(agentDir: string): Promise<string[]> {
  return existsSync(join(agentDir, "skills")) ? readdir(join(agentDir, "skills")) : [];
}

describe("skill marketplace install", () => {
  it("installs a verified skill into the Vela skills directory", () =>
    withRoot(async (root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd, "scripts/run.py": "print(1)" })]);
      await installMarketplaceSkill({ agentDir, id: "docx", ...market.options() });
      assert.equal(await readFile(join(agentDir, "skills", "docx", "SKILL.md"), "utf8"), skillMd);
      assert.equal(await readFile(join(agentDir, "skills", "docx", "scripts", "run.py"), "utf8"), "print(1)");
      const catalog = await loadSkillCatalog({ cwd: root, agentDir });
      assert.ok(catalog.skills.find((item) => item.name === "docx")?.canDelete);
      assert.deepEqual(await skillsDirEntries(agentDir), ["docx"]);
    }));

  it("only requests the manifest when installing, never from GitHub", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      const hosts: string[] = [];
      const spy = ((input: string | URL | Request, init?: RequestInit) => {
        hosts.push(new URL(String(input)).host);
        return market.fetch(input, init);
      }) as typeof fetch;
      await installMarketplaceSkill({ agentDir, id: "docx", ...market.options(), fetch: spy });
      assert.deepEqual([...new Set(hosts)], ["market.test"]);
      assert.equal(market.requests.filter((path) => path.endsWith("/manifest.json")).length, 1);
    }));

  it("rejects a manifest signed by an untrusted key and leaves nothing behind", () =>
    withRoot(async (_root, agentDir) => {
      const attacker = new FakeMarket(keyPair());
      attacker.publish([build("docx", { "SKILL.md": skillMd })], { catalog: false });
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...attacker.options() }), /签名验证失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
      // 没有下载任何文件内容。
      assert.equal(attacker.requests.some((path) => path.includes("/files/")), false);
    }));

  it("rejects a manifest whose bytes were changed after signing", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      const manifest = market.assets.get("/v1/skills/docx/manifest.json") as Uint8Array;
      market.assets.set("/v1/skills/docx/manifest.json", enc.encode(`${new TextDecoder().decode(manifest)} `));
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /签名验证失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("rejects a file whose hash does not match and removes the staging directory", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd, "scripts/run.py": "print(1)" })]);
      // 同样长度、内容被换掉：只有哈希能发现。
      market.assets.set("/v1/skills/docx/files/scripts/run.py", enc.encode("print(2)"));
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /校验失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("rejects a file whose size differs from the manifest", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      market.assets.set("/v1/skills/docx/files/SKILL.md", enc.encode(`${skillMd}extra`));
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /校验失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  /** 签名有效但内容恶意的 manifest：用受信任的私钥手工签出来，模拟维护者的失误。 */
  function signedManifest(market: FakeMarket, id: string, patch: (manifest: Record<string, unknown>) => void, files: Record<string, string> = { "SKILL.md": skillMd }): void {
    const built = build(id, files);
    const manifest = JSON.parse(new TextDecoder().decode(built.manifestBytes)) as Record<string, unknown>;
    patch(manifest);
    const bytes = enc.encode(`${JSON.stringify(manifest)}\n`);
    market.assets.set(`/v1/skills/${id}/manifest.json`, bytes);
    market.assets.set(`/v1/skills/${id}/manifest.json.sig`, enc.encode(signBytes(bytes, trusted.privateKey)));
    for (const file of built.files) market.assets.set(`/v1/skills/${id}/files/${file.path}`, file.bytes);
  }

  for (const [name, path] of [
    ["parent traversal", "../escape.txt"],
    ["absolute path", "/etc/passwd"],
    ["backslash", "..\\escape.txt"],
  ] as const) {
    it(`rejects an unsafe path in a signed manifest (${name})`, () =>
      withRoot(async (root, agentDir) => {
        const market = new FakeMarket();
        signedManifest(market, "docx", (manifest) => {
          (manifest.files as { path: string; size: number; sha256: string }[]).push({ path, size: 1, sha256: sha256Hex(enc.encode("x")) });
        });
        await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /不安全的路径/);
        assert.deepEqual(await skillsDirEntries(agentDir), []);
        assert.equal(existsSync(join(root, "escape.txt")), false);
      }));
  }

  it("rejects a manifest that declares a file over the size limit before downloading anything", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      signedManifest(market, "docx", (manifest) => {
        (manifest.files as { size: number }[])[0]!.size = marketplaceLimits.maxFileBytes + 1;
      });
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /太大/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
      assert.equal(market.requests.some((path) => path.includes("/files/")), false);
    }));

  it("rejects a manifest with too many files", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      signedManifest(market, "docx", (manifest) => {
        const files = manifest.files as { path: string; size: number; sha256: string }[];
        for (let index = 0; index <= marketplaceLimits.maxFiles; index += 1) files.push({ path: `extra/${index}.txt`, size: 1, sha256: sha256Hex(enc.encode("x")) });
      });
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /文件太多/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("rejects a validly signed manifest that belongs to another skill", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd }), build("pdf", { "SKILL.md": "---\nname: pdf\n---\n" })]);
      // 把 pdf 的（有效签名的）manifest 摆到 docx 的位置上。
      market.assets.set("/v1/skills/docx/manifest.json", market.assets.get("/v1/skills/pdf/manifest.json") as Uint8Array);
      market.assets.set("/v1/skills/docx/manifest.json.sig", market.assets.get("/v1/skills/pdf/manifest.json.sig") as Uint8Array);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /校验失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("rejects a replayed older manifest when the catalog pins the current one", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      const older = build("docx", { "SKILL.md": skillMd });
      market.publish([older]);
      const oldManifest = market.assets.get("/v1/skills/docx/manifest.json") as Uint8Array;
      const oldSig = market.assets.get("/v1/skills/docx/manifest.json.sig") as Uint8Array;
      market.publish([build("docx", { "SKILL.md": `${skillMd}newer\n` })]);
      market.assets.set("/v1/skills/docx/manifest.json", oldManifest);
      market.assets.set("/v1/skills/docx/manifest.json.sig", oldSig);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /校验失败/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("rejects a manifest without SKILL.md", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      signedManifest(market, "docx", (manifest) => {
        manifest.files = (manifest.files as { path: string }[]).filter((file) => file.path !== "SKILL.md");
      }, { "SKILL.md": skillMd, "readme.txt": "x" });
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /校验失败/);
    }));

  it("never overwrites an existing folder", () =>
    withRoot(async (_root, agentDir) => {
      await mkdir(join(agentDir, "skills", "docx"), { recursive: true });
      await writeFile(join(agentDir, "skills", "docx", "mine.txt"), "keep");
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", ...market.options() }), /同名文件夹/);
      assert.equal(await readFile(join(agentDir, "skills", "docx", "mine.txt"), "utf8"), "keep");
      // 已经被拒绝的安装不应该请求 manifest（那会被服务端算成一次安装）。
      assert.equal(market.requests.some((path) => path.endsWith("/manifest.json")), false);
    }));

  it("retries a dropped connection", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      market.failures.set("/v1/skills/docx/files/SKILL.md", 1);
      await installMarketplaceSkill({ agentDir, id: "docx", ...market.options() });
      assert.equal(await readFile(join(agentDir, "skills", "docx", "SKILL.md"), "utf8"), skillMd);
    }));

  it("reports an unknown skill and a missing service", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })]);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "not-in-catalog", ...market.options() }), /找不到这个 Skill/);
      // 内置目录里有但云端没有的 Skill：manifest 404。
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "pdf", ...market.options() }), /找不到这个 Skill/);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", fetch: market.fetch, baseUrl: "", publicKeys: [trusted.raw] }), /暂时不可用/);
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "../etc", ...market.options() }), /Skill 不正确/);
      assert.deepEqual(await skillsDirEntries(agentDir), []);
    }));

  it("installs a skill that is only in the cloud catalog", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("brand-new", { "SKILL.md": "---\nname: brand-new\n---\n" })]);
      await installMarketplaceSkill({ agentDir, id: "brand-new", ...market.options() });
      assert.ok(existsSync(join(agentDir, "skills", "brand-new", "SKILL.md")));
    }));
});

describe("skill marketplace listing", () => {
  it("uses the signed cloud catalog and shows install counts", async () => {
    const market = new FakeMarket();
    market.publish([build("docx", { "SKILL.md": skillMd }), build("brand-new", { "SKILL.md": "x" })]);
    market.assets.set("/v1/stats.json", enc.encode(JSON.stringify({ schema: 1, installs: { docx: 42, "brand-new": 3, "Bad Id": 9, neg: -1 } })));
    const listing = await loadMarketplaceListing(market.options());
    assert.equal(listing.source, "cloud");
    assert.deepEqual(listing.skills.map((item) => item.id), ["docx", "brand-new"]);
    assert.deepEqual(listing.installs, { docx: 42, "brand-new": 3 });
    // 目录条目只带界面需要的字段，不带哈希等内部字段。
    assert.equal("manifestSha256" in (listing.skills[0] as object), false);
  });

  it("falls back to the built-in catalog when the cloud is down", async () => {
    const market = new FakeMarket();
    market.down = true;
    const listing = await loadMarketplaceListing(market.options());
    assert.equal(listing.source, "builtin");
    assert.equal(listing.skills.length, marketplaceSkills.length);
    assert.equal(listing.installs, null);
  });

  it("falls back when the catalog signature is invalid", async () => {
    const attacker = new FakeMarket(keyPair());
    attacker.publish([build("evil", { "SKILL.md": "x" })]);
    const listing = await loadMarketplaceListing(attacker.options());
    assert.equal(listing.source, "builtin");
    assert.equal(listing.skills.some((item) => item.id === "evil"), false);
  });

  it("falls back when the catalog is signed but malformed", async () => {
    const market = new FakeMarket();
    const bytes = enc.encode(JSON.stringify({ schema: 1, skills: [{ id: "x" }] }));
    market.assets.set("/v1/catalog.json", bytes);
    market.assets.set("/v1/catalog.json.sig", enc.encode(`${sign(null, bytes, trusted.privateKey).toString("base64")}\n`));
    assert.equal((await loadMarketplaceListing(market.options())).source, "builtin");
  });

  it("hides install counts when stats cannot be loaded but keeps the cloud catalog", async () => {
    const market = new FakeMarket();
    market.publish([build("docx", { "SKILL.md": skillMd })]);
    const listing = await loadMarketplaceListing(market.options());
    assert.equal(listing.source, "cloud");
    assert.equal(listing.installs, null);
  });

  it("still installs from the cloud when only the catalog is unavailable (built-in catalog)", () =>
    withRoot(async (_root, agentDir) => {
      const market = new FakeMarket();
      market.publish([build("docx", { "SKILL.md": skillMd })], { catalog: false });
      assert.equal((await loadMarketplaceListing(market.options())).source, "builtin");
      await installMarketplaceSkill({ agentDir, id: "docx", ...market.options() });
      assert.ok(existsSync(join(agentDir, "skills", "docx", "SKILL.md")));
    }));

  it("is built-in only when no service address is configured", async () => {
    const listing = await loadMarketplaceListing({ baseUrl: "" });
    assert.equal(listing.source, "builtin");
  });
});
