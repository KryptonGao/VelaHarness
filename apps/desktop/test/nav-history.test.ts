import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NavHistory } from "../src/renderer/nav-history.ts";

const make = () => new NavHistory<string>(entry => entry);

describe("NavHistory", () => {
  it("walks back and forward through recorded entries", () => {
    const history = make();
    history.record("a"); history.record("b"); history.record("c");
    assert.equal(history.back(), "b");
    assert.equal(history.back(), "a");
    assert.equal(history.back(), null);
    assert.equal(history.forward(), "b");
    assert.equal(history.canGoForward(), true);
  });

  it("ignores a repeat of the current entry", () => {
    const history = make();
    assert.equal(history.record("a"), true);
    assert.equal(history.record("a"), false);
    assert.equal(history.canGoBack(), false);
  });

  it("drops forward entries when recording after going back", () => {
    const history = make();
    history.record("a"); history.record("b"); history.record("c");
    history.back(); history.back();
    history.record("d");
    assert.equal(history.canGoForward(), false);
    assert.equal(history.back(), "a");
  });

  it("skips invalid entries without losing position when none is valid", () => {
    const history = make();
    history.record("a"); history.record("gone"); history.record("c");
    assert.equal(history.back(entry => entry !== "gone"), "a");
    assert.equal(history.back(), null);
    assert.equal(history.forward(), "gone");
    const lone = make();
    lone.record("a"); lone.record("b");
    assert.equal(lone.back(() => false), null);
    assert.equal(lone.current, "b");
  });

  it("caps the stack size", () => {
    const history = new NavHistory<number>(String, 3);
    for (let i = 0; i < 6; i++) history.record(i);
    assert.equal(history.back(), 4);
    assert.equal(history.back(), 3);
    assert.equal(history.back(), null);
  });
});
