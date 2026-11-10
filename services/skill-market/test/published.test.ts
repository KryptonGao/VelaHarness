import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { marketplacePublicKeys } from "../../../packages/shared/src/marketplace-config.ts";
import { parseMarketplaceCatalog, parseMarketplaceEntry, parseMarketplaceManifest } from "../../../packages/shared/src/marketplace-protocol.ts";
import { verifySignature } from "../../../packages/shared/src/signature.ts";
import { renderBuiltinCatalog, sha256Hex } from "../scripts/build-lib.ts";

/**
 * 守住“推上去的就是签过名、自洽的”：public/ 里的内容必须能被 App 内置的公钥验过，
 * 哈希与磁盘文件一致，目录与 catalog.json、内置目录同源。改了目录忘了重新建置会在这里失败。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicV1 = join(root, "public", "v1");
const text = (path: string) => readFileSync(path, "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)]));
}

describe("published market content", () => {
  const catalogBytes = readFileSync(join(publicV1, "catalog.json"));
  const catalog = parseMarketplaceCatalog(catalogBytes.toString("utf8"));

  it("has a catalog signed by a bundled public key", () => {
    assert.ok(marketplacePublicKeys.length > 0);
    assert.ok(verifySignature(catalogBytes, text(join(publicV1, "catalog.json.sig")), marketplacePublicKeys));
    assert.equal(verifySignature(Buffer.concat([catalogBytes, Buffer.from(" ")]), text(join(publicV1, "catalog.json.sig")), marketplacePublicKeys), false);
  });

  it("lists exactly the skills in catalog.json, pinned to their commits", () => {
    const source = (JSON.parse(text(join(root, "catalog.json"))) as { skills: (Record<string, unknown> & { commit: string })[] }).skills;
    assert.deepEqual(catalog.skills.map((item) => item.id), source.map((item) => String(item.id)));
    for (const [index, item] of source.entries()) assert.equal(catalog.skills[index]?.commit, item.commit);
  });

  it("keeps the built-in catalog in sync with catalog.json", () => {
    const source = (JSON.parse(text(join(root, "catalog.json"))) as { skills: unknown[] }).skills.map(parseMarketplaceEntry);
    assert.equal(text(resolve(root, "../../packages/shared/src/marketplace-builtin.ts")), renderBuiltinCatalog(source));
  });

  for (const entry of catalog.skills) {
    it(`${entry.id}: manifest is signed, pinned by the catalog, and matches the files`, () => {
      const dir = join(publicV1, "skills", entry.id);
      const manifestBytes = readFileSync(join(dir, "manifest.json"));
      assert.ok(verifySignature(manifestBytes, text(join(dir, "manifest.json.sig")), marketplacePublicKeys));
      assert.equal(sha256Hex(manifestBytes), entry.manifestSha256);
      const manifest = parseMarketplaceManifest(manifestBytes.toString("utf8"));
      assert.equal(manifest.id, entry.id);
      assert.equal(manifest.skill, entry.skill);
      assert.equal(manifest.commit, entry.commit);
      assert.equal(manifest.files.length, entry.fileCount);
      for (const file of manifest.files) {
        const bytes = readFileSync(join(dir, "files", file.path));
        assert.equal(bytes.byteLength, file.size, file.path);
        assert.equal(sha256Hex(bytes), file.sha256, file.path);
      }
      // 目录里不能有 manifest 没列出的文件，否则就是没被签名的内容。
      const onDisk = walk(join(dir, "files")).map((path) => relative(join(dir, "files"), path)).sort();
      assert.deepEqual(onDisk, manifest.files.map((file) => file.path).sort());
    });
  }

  it("publishes nothing else under v1", () => {
    const allowed = new Set(["catalog.json", "catalog.json.sig"]);
    for (const name of readdirSync(publicV1)) assert.ok(allowed.has(name) || name === "skills", name);
    for (const name of readdirSync(join(publicV1, "skills"))) {
      assert.ok(statSync(join(publicV1, "skills", name)).isDirectory());
      assert.ok(catalog.skills.some((item) => item.id === name), `${name} is not in the catalog`);
      assert.deepEqual(readdirSync(join(publicV1, "skills", name)).sort(), ["files", "manifest.json", "manifest.json.sig"]);
    }
  });
});
