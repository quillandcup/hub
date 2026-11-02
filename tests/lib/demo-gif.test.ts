import { describe, expect, it } from "vitest";
import { animatedGif, bouncingDisc, DISC_PALETTE } from "@/demo/gif";

describe("the demo's animated GIF", () => {
  const gif = animatedGif(16, DISC_PALETTE, bouncingDisc(16), 300);

  it("is a looping GIF89a of the right size", () => {
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(16);
    expect(gif.readUInt16LE(8)).toBe(16);
    expect(gif.toString("latin1")).toContain("NETSCAPE2.0");
    expect(gif[gif.length - 1]).toBe(0x3b);
  });

  it("has two frames that differ, so a still and a moving image are distinguishable", () => {
    const [a, b] = bouncingDisc(16);
    expect(a).not.toEqual(b);
    expect(a.every((p) => p < 4)).toBe(true);
  });

  it("rejects a frame of the wrong size", () => {
    expect(() => animatedGif(4, DISC_PALETTE, [new Uint8Array(3)], 100)).toThrow(/size x size/);
  });
});
