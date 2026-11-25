import assert from "node:assert/strict";
import test from "node:test";
import type { FileAttachmentPayload } from "@vela/shared";
import { composerDraftKey, createComposerDrafts } from "../src/renderer/components/composer/composer-drafts.ts";

const a = composerDraftKey("a", false);
const b = composerDraftKey("b", false);
const file: FileAttachmentPayload = { kind: "file", name: "build.log", path: "/tmp/build.log", image: null };
const image: FileAttachmentPayload = { kind: "image", name: "pasted.png", path: "", image: { type: "image", mimeType: "image/png", data: "AA==" } };
const empty = { text: "", attachments: [] };

test("text and attachment-only drafts are kept separately per conversation", () => {
  const drafts = createComposerDrafts();
  drafts.set(a, { attachments: [image] });
  drafts.set(b, { text: "world", attachments: [file] });
  drafts.set(a, { text: "   \n" });
  assert.deepEqual(drafts.get(a), { text: "", attachments: [image] });
  assert.deepEqual(drafts.get(b), { text: "world", attachments: [file] });
  assert.deepEqual(drafts.get(composerDraftKey(null, false)), empty);
  drafts.set(a, { attachments: [] });
  assert.deepEqual(drafts.get(a), empty);
});

test("a rejected send restores only the originating draft and never overwrites new work", () => {
  const drafts = createComposerDrafts();
  drafts.set(a, { text: "read this", attachments: [file] });
  const sent = drafts.get(a);
  drafts.set(a, empty);
  drafts.set(b, { attachments: [image] });
  drafts.restoreIfEmpty(a, sent);
  assert.deepEqual(drafts.get(a), sent);
  assert.deepEqual(drafts.get(b), { text: "", attachments: [image] });
  for (const replacement of [{ text: "new text", attachments: [] }, { text: "", attachments: [image] }]) {
    drafts.set(a, replacement);
    drafts.restoreIfEmpty(a, sent);
    assert.deepEqual(drafts.get(a), replacement);
  }
});

test("a new window without a conversation has its own draft", () => {
  const drafts = createComposerDrafts();
  drafts.set(composerDraftKey(null, false), { text: "new chat text" });
  assert.equal(drafts.get(composerDraftKey(null, false)).text, "new chat text");
  assert.deepEqual(drafts.get(a), empty);
});

test("embedded and main composers do not share a draft", () => {
  assert.notEqual(composerDraftKey("a", true), a);
});

test("sidebar draft presence follows both editors and ignores edits within an existing draft", () => {
  const drafts = createComposerDrafts();
  const workbench = composerDraftKey("a", true);
  const locations: (string | null)[] = [];
  const unsubscribe = drafts.subscribePresence(() => locations.push(drafts.conversationDraftLocation("a")));
  drafts.set(workbench, { attachments: [image] });
  drafts.set(a, { text: "hello" });
  drafts.set(a, { text: "hello again" });
  assert.equal(drafts.conversationDraftLocation("b"), null);
  drafts.set(a, { text: " " });
  drafts.set(workbench, empty);
  drafts.restoreIfEmpty(a, { text: "", attachments: [file] });
  unsubscribe();
  drafts.set(a, empty);
  drafts.set(composerDraftKey("a", false, true), { text: "new conversation" });
  assert.equal(drafts.conversationDraftLocation("a"), null);
  assert.deepEqual(locations, ["workbench", "main", "workbench", null, "main"]);
});

test("empty new chats share one draft so it survives leaving them", () => {
  assert.equal(composerDraftKey("a", false, true), composerDraftKey("b", false, true));
  assert.notEqual(composerDraftKey("a", false, true), a);
  assert.notEqual(composerDraftKey("a", true, true), composerDraftKey("b", true, true));
});
