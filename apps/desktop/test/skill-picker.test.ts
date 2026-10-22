import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SkillSummary } from "@vela/shared";
import {
  applySkillPick,
  filterSkills,
  parseSkillSegments,
  skillOriginLabel,
  skillTitle,
  slashTokenAt,
} from "../src/renderer/components/composer/skill-picker.ts";

function skill(name: string, description: string, enabled = true): SkillSummary {
  return {
    name,
    description,
    location: `/skills/${name}/SKILL.md`,
    origin: "user",
    disableModelInvocation: false,
    enabled,
    canDelete: false,
  };
}

describe("slashTokenAt", () => {
  it("reads a slash query at the caret and keeps the rest of the token", () => {
    const token = slashTokenAt("请用 /apple 设计", "请用 /app".length);
    assert.deepEqual(token, { start: 3, end: 9, query: "app" });
  });

  it("opens on a bare slash at the start or after whitespace", () => {
    assert.equal(slashTokenAt("/", 1)?.query, "");
    assert.equal(slashTokenAt("hello\n/", 7)?.query, "");
  });

  it("ignores slashes inside words and urls", () => {
    assert.equal(slashTokenAt("http://exa", 10), null);
    assert.equal(slashTokenAt("路径a/b", 4), null);
  });
});

describe("applySkillPick", () => {
  it("removes the slash token and the separating space", () => {
    const token = slashTokenAt("hello /app world", "hello /app".length);
    assert.ok(token);
    assert.deepEqual(applySkillPick("hello /app world", token), { text: "hello world", caret: 5 });
  });

  it("clears the field when the slash token is the whole draft", () => {
    const token = slashTokenAt("/apple-design", 13);
    assert.ok(token);
    assert.deepEqual(applySkillPick("/apple-design", token), { text: "", caret: 0 });
  });
});

describe("filterSkills", () => {
  const skills = [
    skill("design-report", "Create documents with the Design Report template"),
    skill("apple-design", "Apple's approach to interface design"),
    skill("documents", "Create and edit documents"),
  ];

  it("lists every skill, with prefix matches first", () => {
    assert.deepEqual(filterSkills(skills, "").map((item) => item.name), [
      "apple-design",
      "design-report",
      "documents",
    ]);
    assert.deepEqual(filterSkills(skills, "app").map((item) => item.name), ["apple-design"]);
    assert.deepEqual(filterSkills(skills, "template").map((item) => item.name), ["design-report"]);
  });

  it("leaves out disabled skills", () => {
    const mixed = [...skills, skill("hidden", "Should not appear", false)];
    assert.deepEqual(filterSkills(mixed, "").map((item) => item.name), [
      "apple-design",
      "design-report",
      "documents",
    ]);
    assert.deepEqual(filterSkills(mixed, "hidden"), []);
  });
});

describe("prompt formatting", () => {
  it("turns a kebab-case name into a title", () => {
    assert.equal(skillTitle("apple-design"), "Apple Design");
    assert.equal(skillOriginLabel("user"), "个人");
    assert.equal(skillOriginLabel("project"), "项目");
  });

  it("parses a sent skill command back into a chip and the remaining request", () => {
    assert.deepEqual(parseSkillSegments("/skill:apple-design 改一下登录页\n\n[图片 ×1]"), [
      { type: "skill", name: "apple-design" },
      { type: "text", text: "改一下登录页\n\n[图片 ×1]" },
    ]);
    assert.equal(parseSkillSegments("普通消息"), null);
    assert.equal(parseSkillSegments("网址 http://a/skill:b 不算"), null);
  });

  it("keeps several skills where they sit between the words", () => {
    assert.deepEqual(parseSkillSegments("先用 /skill:apple-design 调整样式，再 /skill:documents 写说明"), [
      { type: "text", text: "先用" },
      { type: "skill", name: "apple-design" },
      { type: "text", text: "调整样式，再" },
      { type: "skill", name: "documents" },
      { type: "text", text: "写说明" },
    ]);
    assert.deepEqual(parseSkillSegments("/skill:a /skill:b"), [
      { type: "skill", name: "a" },
      { type: "skill", name: "b" },
    ]);
    assert.deepEqual(parseSkillSegments("第一行\n/skill:a 第二行"), [
      { type: "text", text: "第一行\n" },
      { type: "skill", name: "a" },
      { type: "text", text: "第二行" },
    ]);
  });

  it("hides the expanded skill body and keeps only the user's request", () => {
    const expanded = [
      '<skill name="beautify-github-readme" location="/Users/chenkaigao/vela/skills/beautify-github-readme/SKILL.md">',
      "References are relative to /Users/chenkaigao/vela/skills/beautify-github-readme.",
      "",
      "# Beautify Github README",
      "Turn a repository homepage into a visual story.",
      "</skill>",
      "",
      "优化这个 README，再用 /skill:documents 写说明",
    ].join("\n");
    assert.deepEqual(parseSkillSegments(expanded), [
      { type: "skill", name: "beautify-github-readme" },
      { type: "text", text: "优化这个 README，再用" },
      { type: "skill", name: "documents" },
      { type: "text", text: "写说明" },
    ]);
    assert.deepEqual(
      parseSkillSegments(
        '<skill name="apple-design" location="/skills/apple-design/SKILL.md">\n# Apple\n</skill>',
      ),
      [{ type: "skill", name: "apple-design" }],
    );
    assert.equal(parseSkillSegments("正文里提到 <skill name=\"x\"> 但不是整条消息"), null);
  });
});
