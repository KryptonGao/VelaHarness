import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadSkillCatalog } from "../src/skill-catalog.ts";
import { installMarketplaceSkill } from "../src/skill-marketplace.ts";

function fakeFetch(tree: Array<{ path: string; type: string; size?: number }>, bodies: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.github.com") && url.includes("/git/trees/")) {
      return new Response(JSON.stringify({ tree, truncated: false }));
    }
    const path = decodeURIComponent(url.split("/HEAD/")[1] ?? "");
    const body = bodies[path];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  }) as typeof fetch;
}

const skillMd = "---\nname: docx\ndescription: Word documents\n---\nBody\n";

describe("skill marketplace install", () => {
  it("downloads the skill folder into the Vela skills directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const agentDir = join(root, ".vela");
      const fetchImpl = fakeFetch(
        [
          { path: "skills/docx/SKILL.md", type: "blob", size: 10 },
          { path: "skills/docx/scripts/run.py", type: "blob", size: 5 },
          { path: "skills/docx/scripts", type: "tree" },
          { path: "skills/pdf/SKILL.md", type: "blob", size: 5 },
        ],
        { "skills/docx/SKILL.md": skillMd, "skills/docx/scripts/run.py": "print(1)" },
      );
      await installMarketplaceSkill({ agentDir, id: "docx", fetch: fetchImpl });
      assert.equal(await readFile(join(agentDir, "skills", "docx", "SKILL.md"), "utf8"), skillMd);
      assert.equal(await readFile(join(agentDir, "skills", "docx", "scripts", "run.py"), "utf8"), "print(1)");
      assert.equal(existsSync(join(agentDir, "skills", "pdf")), false);
      const catalog = await loadSkillCatalog({ cwd: root, agentDir });
      const skill = catalog.skills.find((item) => item.name === "docx");
      assert.ok(skill?.canDelete);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves nothing behind when a download fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const agentDir = join(root, ".vela");
      const fetchImpl = fakeFetch(
        [
          { path: "skills/docx/SKILL.md", type: "blob", size: 10 },
          { path: "skills/docx/big.bin", type: "blob", size: 10 },
        ],
        { "skills/docx/SKILL.md": skillMd },
      );
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", fetch: fetchImpl }));
      assert.equal(existsSync(join(agentDir, "skills", "docx")), false);
      const { readdir } = await import("node:fs/promises");
      assert.deepEqual(await readdir(join(agentDir, "skills")), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds nested folders and a differently named upstream folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const agentDir = join(root, ".vela");
      const nested = fakeFetch(
        [
          { path: "skills/productivity/grill-me/SKILL.md", type: "blob", size: 4 },
          { path: ".claude/skills/grill-me/SKILL.md", type: "blob", size: 4 },
          { path: "skills/productivity/grill-me/extra.md", type: "blob", size: 2 },
        ],
        { "skills/productivity/grill-me/SKILL.md": "nest", "skills/productivity/grill-me/extra.md": "ex" },
      );
      await installMarketplaceSkill({ agentDir, id: "grill-me", fetch: nested });
      assert.equal(await readFile(join(agentDir, "skills", "grill-me", "extra.md"), "utf8"), "ex");

      const renamed = fakeFetch(
        [{ path: "skills/react-best-practices/SKILL.md", type: "blob", size: 3 }],
        { "skills/react-best-practices/SKILL.md": "rbp" },
      );
      await installMarketplaceSkill({ agentDir, id: "vercel-react-best-practices", fetch: renamed });
      assert.equal(await readFile(join(agentDir, "skills", "vercel-react-best-practices", "SKILL.md"), "utf8"), "rbp");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never overwrites an existing folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const agentDir = join(root, ".vela");
      await mkdir(join(agentDir, "skills", "docx"), { recursive: true });
      await writeFile(join(agentDir, "skills", "docx", "mine.txt"), "keep");
      const fetchImpl = fakeFetch([{ path: "skills/docx/SKILL.md", type: "blob", size: 10 }], { "skills/docx/SKILL.md": skillMd });
      await assert.rejects(installMarketplaceSkill({ agentDir, id: "docx", fetch: fetchImpl }));
      assert.equal(await readFile(join(agentDir, "skills", "docx", "mine.txt"), "utf8"), "keep");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries a dropped connection", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const agentDir = join(root, ".vela");
      const inner = fakeFetch([{ path: "skills/docx/SKILL.md", type: "blob", size: 10 }], { "skills/docx/SKILL.md": skillMd });
      let drops = 1;
      const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes("raw.githubusercontent.com") && drops-- > 0) throw new TypeError("fetch failed");
        return inner(input, init);
      }) as typeof fetch;
      await installMarketplaceSkill({ agentDir, id: "docx", fetch: flaky });
      assert.equal(await readFile(join(agentDir, "skills", "docx", "SKILL.md"), "utf8"), skillMd);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a listing without SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "vela-market-"));
    try {
      const fetchImpl = fakeFetch([{ path: "skills/docx/readme.txt", type: "blob", size: 1 }], {});
      await assert.rejects(installMarketplaceSkill({ agentDir: join(root, ".vela"), id: "docx", fetch: fetchImpl }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
