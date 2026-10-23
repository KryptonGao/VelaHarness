import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deepseekWebProvider } from "@vela/shared";
import { parseWebProvider } from "@vela/agent";
import { draftFromProvider, emptyDraft, providerFromDraft, providerIdFromName } from "../src/renderer/components/web-tools-settings-model.ts";

const none = new Set<string>();

describe("web tools settings model", () => {
  it("builds a valid provider from the default draft once the basics are filled", () => {
    const draft = emptyDraft();
    draft.name = "My Search";
    draft.search.url = "https://api.example.com/v1/search";
    const built = providerFromDraft(draft, none);
    assert.ok(built.ok);
    assert.equal(built.ok && built.provider.id, "my-search");
    assert.doesNotThrow(() => parseWebProvider(built.ok ? built.provider : null));
    assert.equal(built.ok && built.provider.fetch, undefined, "fetch stays off until enabled");
  });

  it("round-trips the built-in DeepSeek provider through a draft", () => {
    const back = providerFromDraft({ ...draftFromProvider(deepseekWebProvider), id: "deepseek" }, none);
    assert.ok(back.ok);
    const rebuilt = back.ok ? back.provider : null;
    assert.deepEqual(rebuilt?.search, deepseekWebProvider.search);
    assert.deepEqual(rebuilt?.fetch, deepseekWebProvider.fetch);
  });

  it("reports the first problem a person can fix", () => {
    const draft = emptyDraft();
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "name" });
    draft.name = "X";
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "url" });
    draft.search.url = "https://a.example";
    draft.search.body = "{ nope";
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "json" });
    draft.search.body = "";
    draft.search.authType = "header";
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "authName" });
    draft.search.authType = "bearer";
    draft.search.link = "";
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "searchFields" });
    draft.search.link = "url";
    draft.search.enabled = false;
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "nothing" });
    draft.fetch.enabled = true;
    draft.fetch.url = "https://a.example/fetch";
    draft.fetch.contentPath = "";
    assert.deepEqual(providerFromDraft(draft, none), { ok: false, error: "fetchFields" });
  });

  it("drops the request body for GET and keeps optional fields only when filled", () => {
    const draft = emptyDraft();
    draft.name = "Getter";
    draft.search.url = "https://a.example/s";
    draft.search.method = "GET";
    draft.search.query = '{ "q": "{{query}}" }';
    draft.search.summary = "abstract";
    const built = providerFromDraft(draft, none);
    assert.ok(built.ok);
    const search = built.ok ? built.provider.search : undefined;
    assert.equal(search?.body, undefined);
    assert.deepEqual(search?.query, { q: "{{query}}" });
    assert.deepEqual(search?.fields, { title: "title", url: "url", snippet: "snippet", summary: "abstract" });
  });

  it("makes unique, valid ids from names", () => {
    assert.equal(providerIdFromName("My Search!", none), "my-search");
    assert.equal(providerIdFromName("搜索引擎", none), "provider");
    assert.equal(providerIdFromName("Mine", new Set(["mine"])), "mine-2");
    assert.equal(providerIdFromName("Mine", new Set(["mine", "mine-2"])), "mine-3");
    assert.equal(providerIdFromName("  ", none), "provider");
  });
});
