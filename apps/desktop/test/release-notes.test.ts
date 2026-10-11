import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appLocales, parseReleaseNotesFile, selectReleaseNotes } from "@vela/shared";
import { loadReleaseNotes } from "../src/main/release-notes-loader.ts";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filePath = join(desktop, "release-notes.json");
const packageVersion = (JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { version: string }).version;
const sample = (version: string) => JSON.stringify({
  version,
  locales: {
    en: { summary: "English.", highlights: [{ title: "A", body: "b" }], improvements: ["c"] },
    ja: { summary: "日本語。", highlights: [{ title: "あ", body: "い" }], improvements: [] },
    ko: { summary: "", highlights: [], improvements: [] },
  },
});

test("release-notes.json ships all five languages for the current version", () => {
  const file = parseReleaseNotesFile(JSON.parse(readFileSync(filePath, "utf8")));
  assert.ok(file, "release-notes.json must be valid");
  assert.equal(file.version, packageVersion, "release-notes.json must describe the package version");
  const english = file.locales.en;
  for (const locale of appLocales) {
    const notes = file.locales[locale];
    assert.ok(notes, `${locale} is missing or malformed`);
    assert.equal(notes.highlights.length, english.highlights.length, `${locale} highlights differ from English`);
    assert.equal(notes.improvements.length, english.improvements.length, `${locale} improvements differ from English`);
  }
});

test("rejects malformed files and keeps only well-formed languages", () => {
  assert.equal(parseReleaseNotesFile(null), null);
  assert.equal(parseReleaseNotesFile({ version: "x", locales: {} }), null);
  assert.equal(parseReleaseNotesFile({ version: "1.0.0", locales: { ja: { summary: "a", highlights: [{ title: "a", body: "b" }], improvements: [] } } }), null, "English is required");
  const file = parseReleaseNotesFile(JSON.parse(sample("1.2.3")));
  assert.ok(file);
  assert.deepEqual(Object.keys(file.locales).sort(), ["en", "ja"], "an empty translation is dropped");
});

test("selects the requested language and falls back to English", () => {
  const file = parseReleaseNotesFile(JSON.parse(sample("1.2.3")))!;
  assert.equal(selectReleaseNotes(file, "ja").summary, "日本語。");
  assert.equal(selectReleaseNotes(file, "ko").locale, "en");
  assert.equal(selectReleaseNotes(file, "bogus").locale, "en");
  assert.equal(selectReleaseNotes(file, "zh-TW").version, "1.2.3");
});

test("the loader returns notes only for the running version and never throws", async () => {
  assert.equal((await loadReleaseNotes("/n.json", "ja", "1.2.3", async () => sample("1.2.3")))?.locale, "ja");
  assert.equal(await loadReleaseNotes("/n.json", "ja", "1.2.4", async () => sample("1.2.3")), null, "another version is never shown");
  assert.equal(await loadReleaseNotes("/n.json", "ja", "1.2.3", async () => "{ not json"), null);
  assert.equal(await loadReleaseNotes("/n.json", "ja", "1.2.3", async () => { throw new Error("ENOENT"); }), null);
});
