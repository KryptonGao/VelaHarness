import assert from "node:assert/strict";
import test from "node:test";
import { composerDraftKey, createComposerDrafts } from "../src/renderer/components/composer/composer-drafts.ts";

test("drafts are kept separately per conversation", () => {
  const drafts = createComposerDrafts();
  drafts.set(composerDraftKey("a", false), "hello");
  drafts.set(composerDraftKey("b", false), "world");
  assert.equal(drafts.get(composerDraftKey("a", false)), "hello");
  assert.equal(drafts.get(composerDraftKey("b", false)), "world");
  assert.equal(drafts.get(composerDraftKey("c", false)), "");
});

test("a new window without a conversation has its own draft", () => {
  const drafts = createComposerDrafts();
  drafts.set(composerDraftKey(null, false), "new chat text");
  assert.equal(drafts.get(composerDraftKey(null, false)), "new chat text");
  assert.equal(drafts.get(composerDraftKey("a", false)), "");
});

test("embedded and main composers do not share a draft", () => {
  assert.notEqual(composerDraftKey("a", true), composerDraftKey("a", false));
});

test("clearing or blank text drops the draft", () => {
  const drafts = createComposerDrafts();
  const key = composerDraftKey("a", false);
  drafts.set(key, "text");
  drafts.set(key, "");
  assert.equal(drafts.get(key), "");
  drafts.set(key, "   \n");
  assert.equal(drafts.get(key), "");
});

test("empty new chats share one draft so it survives leaving them", () => {
  assert.equal(composerDraftKey("a", false, true), composerDraftKey("b", false, true));
  assert.notEqual(composerDraftKey("a", false, true), composerDraftKey("a", false));
  assert.notEqual(composerDraftKey("a", true, true), composerDraftKey("b", true, true));
});
