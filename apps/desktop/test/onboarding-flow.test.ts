import assert from "node:assert/strict";
import test from "node:test";
import { appLocales, localizeCopy } from "@vela/shared";
import zhTW from "../../../packages/shared/src/i18n-messages/zh-TW.ts";
import ja from "../../../packages/shared/src/i18n-messages/ja.ts";
import ko from "../../../packages/shared/src/i18n-messages/ko.ts";
import { onboardingCopy } from "../src/renderer/components/onboarding-copy.ts";
import { configScreens, isOnboardingScreen, restoreScreen, screenOrder } from "../src/renderer/components/onboarding-flow.ts";

test("full flow starts at the language picker and ends at done", () => {
  const withNews = screenOrder("full", true);
  assert.equal(withNews[0], "language");
  assert.equal(withNews.at(-1), "done");
  assert.ok(withNews.indexOf("news") < withNews.indexOf("step-1"));
  assert.deepEqual(withNews.filter((screen) => screen.startsWith("step-")), configScreens);
});

test("the news screen is skipped without release notes", () => {
  assert.ok(!screenOrder("full", false).includes("news"));
  assert.ok(!screenOrder("intro", false).includes("news"));
});

test("intro mode has neither the language picker nor setup steps", () => {
  const order = screenOrder("intro", true);
  assert.deepEqual(order, ["hello", "tour", "feat-agents", "feat-trace", "feat-compact", "news"]);
});

test("restoreScreen reads new ids and migrates the legacy numeric step", () => {
  assert.equal(restoreScreen("step-3", null), "step-3");
  assert.equal(restoreScreen("tour", "5"), "tour");
  assert.equal(restoreScreen(null, "5"), "step-5");
  assert.equal(restoreScreen(null, "9"), "done");
  assert.equal(restoreScreen(null, "0"), "language");
  assert.equal(restoreScreen("bogus", null), "language");
  assert.equal(restoreScreen(undefined, undefined), "language");
  assert.ok(isOnboardingScreen("feat-trace") && !isOnboardingScreen("feat-other"));
});

function collect(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collect(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collect(item, out));
  return out;
}

test("every onboarding string has zh-TW, ja and ko translations unless it is a proper name", () => {
  const keep = new Set(["Codex", "Claude Code", "Vela", "Skills"]);
  const strings = collect(onboardingCopy("zh-CN"), []).filter((text) => !keep.has(text));
  for (const [name, dictionary] of [["zh-TW", zhTW], ["ja", ja], ["ko", ko]] as const) {
    const missing = strings.filter((text) => !(text in dictionary));
    assert.deepEqual(missing, [], `${name} is missing onboarding translations`);
  }
});

test("localised onboarding copy keeps placeholders intact", () => {
  for (const locale of appLocales) {
    const copy = onboardingCopy(locale);
    assert.match(copy.featureChip, /\{0\}/);
    assert.match(copy.stepChip, /\{0\}/);
  }
  assert.ok(localizeCopy("ja", { a: "重看介绍" }, { a: "Replay" }).a !== "Replay");
});
