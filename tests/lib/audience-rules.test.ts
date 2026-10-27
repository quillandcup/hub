import { describe, expect, it } from "vitest";
import { audienceChainError, withAudienceChange } from "@/lib/audience-rules";

describe("audienceChainError", () => {
  it.each([
    [{ listed: false, publicly: false, guests: false }, null],
    [{ listed: true, publicly: false, guests: false }, null],
    [{ listed: true, publicly: true, guests: false }, null],
    [{ listed: true, publicly: true, guests: true }, null],
    [{ listed: false, publicly: true, guests: false }, "Only something listed in Events can be announced publicly"],
    [{ listed: false, publicly: true, guests: true }, "Only something listed in Events can be announced publicly"],
    [{ listed: true, publicly: false, guests: true }, "Guests can only be allowed at something announced publicly"],
    [{ listed: false, publicly: false, guests: true }, "Guests can only be allowed at something announced publicly"],
  ])("%j -> %j", (flags, expected) => {
    expect(audienceChainError(flags)).toBe(expected);
  });
});

describe("withAudienceChange", () => {
  const all = { listed: true, publicly: true, guests: true };

  it("unchecking a flag unchecks what depended on it", () => {
    expect(withAudienceChange(all, { guests: false })).toEqual({ listed: true, publicly: true, guests: false });
    expect(withAudienceChange(all, { publicly: false })).toEqual({ listed: true, publicly: false, guests: false });
    expect(withAudienceChange(all, { listed: false })).toEqual({ listed: false, publicly: false, guests: false });
  });

  it("checking a flag changes only that one", () => {
    expect(withAudienceChange({ listed: false, publicly: false, guests: false }, { listed: true })).toEqual({ listed: true, publicly: false, guests: false });
  });

  it("always gives flags that pass the chain", () => {
    for (const listed of [true, false]) {
      for (const publicly of [true, false]) {
        for (const guests of [true, false]) {
          expect(audienceChainError(withAudienceChange({ listed: true, publicly: true, guests: true }, { listed, publicly, guests }))).toBeNull();
        }
      }
    }
  });
});
