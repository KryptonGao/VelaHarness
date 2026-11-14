import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dictationSeparator, encodeWav, toPcm16 } from "../src/renderer/dictation-audio.ts";

describe("dictation audio", () => {
  it("resamples to 16 kHz and quantizes to 16-bit", () => {
    const input = new Float32Array(48_000).fill(0.5);
    const out = toPcm16([input.subarray(0, 20_000), input.subarray(20_000)], 48_000);
    assert.equal(out.length, 16_000);
    assert.equal(out[0], Math.round(0.5 * 0x7fff));
    const clipped = toPcm16([new Float32Array([2, -2, 2, -2])], 16_000);
    assert.deepEqual([...clipped], [0x7fff, -0x8000, 0x7fff, -0x8000]);
    assert.equal(toPcm16([], 48_000).length, 0);
  });

  it("writes a mono 16-bit PCM WAV header", () => {
    const wav = encodeWav(new Int16Array([1, -1, 2]));
    const view = new DataView(wav.buffer);
    const tag = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    assert.equal(wav.byteLength, 44 + 6);
    assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ["RIFF", "WAVE", "fmt ", "data"]);
    assert.equal(view.getUint32(4, true), 36 + 6);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 16_000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 6);
    assert.equal(view.getInt16(46, true), -1);
  });

  it("separates appended text only between latin words", () => {
    assert.equal(dictationSeparator("fix the", "bug"), " ");
    assert.equal(dictationSeparator("fix the ", "bug"), "");
    assert.equal(dictationSeparator("你好", "world"), "");
    assert.equal(dictationSeparator("", "bug"), "");
  });
});
