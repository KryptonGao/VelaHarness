import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCustomCommands, parseCommandMarkdown } from "../src/custom-commands.ts";
import { expandCustomCommand, parseSlashInvocation } from "../../shared/src/custom-commands.ts";

async function createTempRoots(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-commands-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".vela", "commands"), { recursive: true });
  await mkdir(join(agentDir, "commands"), { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    cwd,
    agentDir,
    projectCommands: join(cwd, ".vela", "commands"),
    userCommands: join(agentDir, "commands"),
  };
}

describe("custom commands (.vela/commands/*.md)", () => {
  it("parses YAML frontmatter when present and preserves pure Markdown horizontal rules", () => {
    const withFrontmatter = parseCommandMarkdown(
      '\uFEFF---\r\ndescription: "Run regression suite"\r\nargument-hint: "[scope]"\r\n---\r\n\r\n# Steps\r\nRun tests for $ARGUMENTS.',
    );
    assert.equal(withFrontmatter.description, "Run regression suite");
    assert.equal(withFrontmatter.argumentHint, "[scope]");
    assert.equal(withFrontmatter.content, "# Steps\nRun tests for $ARGUMENTS.");

    const pureMarkdown = parseCommandMarkdown("## Release Audit\nCheck git log and tag state.");
    assert.equal(pureMarkdown.description, "Release Audit");
    assert.equal(pureMarkdown.argumentHint, undefined);
    assert.equal(pureMarkdown.content, "## Release Audit\nCheck git log and tag state.");

    const startsWithRule = parseCommandMarkdown("---\nFirst section without YAML keys\n---\nBody");
    assert.equal(startsWithRule.content, "---\nFirst section without YAML keys\n---\nBody");
  });

  it("expands $ARGUMENTS and ${ARGUMENTS:-default} safely", () => {
    assert.equal(
      expandCustomCommand("Check $ARGUMENTS and also keep $ARGUMENTS.", "src/$1 $&"),
      "Check src/$1 $& and also keep src/$1 $&.",
    );
    assert.equal(
      expandCustomCommand("Run in ${ARGUMENTS:-staging} env", "   "),
      "Run in staging env",
    );
    assert.equal(
      expandCustomCommand("Run in ${ARGUMENTS:-staging} env", "prod"),
      "Run in prod env",
    );
    assert.equal(
      expandCustomCommand("Summarize recent changes.", "focus on tests"),
      "Summarize recent changes.\n\nfocus on tests",
    );
    assert.equal(
      expandCustomCommand("Keep $ARGUMENTS_EXTRA untouched: $ARGUMENTS", "ok"),
      "Keep $ARGUMENTS_EXTRA untouched: ok",
    );
  });

  it("parses slash invocations", () => {
    assert.deepEqual(parseSlashInvocation("  /deploy   prod --dry-run "), { name: "deploy", args: "prod --dry-run" });
    assert.deepEqual(parseSlashInvocation("/status"), { name: "status", args: "" });
    assert.equal(parseSlashInvocation("hello /world"), null);
    assert.equal(parseSlashInvocation("/"), null);
  });

  it("loads user and project commands, prefers project on collisions, and respects hasWorkspace=false", async (t) => {
    const dirs = await createTempRoots(t);
    await writeFile(join(dirs.userCommands, "greet.md"), "Say hello from user.");
    await writeFile(join(dirs.userCommands, "shared.md"), "User version for $ARGUMENTS");
    await writeFile(join(dirs.projectCommands, "shared.md"), "---\ndescription: Project override\n---\nProject version for $ARGUMENTS");
    await writeFile(join(dirs.projectCommands, "deploy.md"), "Deploy service now.");
    await writeFile(join(dirs.projectCommands, "notes.txt"), "ignored non-md");
    await writeFile(join(dirs.projectCommands, "empty.md"), "   \n");
    await writeFile(join(dirs.projectCommands, "skill:bad.md"), "Bad prefix");
    await symlink(join(dirs.projectCommands, "missing-target.md"), join(dirs.projectCommands, "broken.md"));

    const catalog = loadCustomCommands({ cwd: dirs.cwd, agentDir: dirs.agentDir });
    assert.equal(catalog.commandsDir, dirs.userCommands);
    assert.deepEqual(catalog.commands.map((c) => [c.name, c.origin, c.acceptsArguments]), [
      ["deploy", "project", false],
      ["greet", "user", false],
      ["shared", "project", true],
    ]);
    const shared = catalog.commands.find((c) => c.name === "shared")!;
    assert.equal(shared.description, "Project override");
    assert.match(shared.content, /^Project version/);
    assert.equal(catalog.diagnostics.length, 3);

    const noWorkspace = loadCustomCommands({ cwd: dirs.cwd, agentDir: dirs.agentDir, hasWorkspace: false });
    assert.deepEqual(noWorkspace.commands.map((c) => [c.name, c.origin]), [
      ["greet", "user"],
      ["shared", "user"],
    ]);
  });
});
