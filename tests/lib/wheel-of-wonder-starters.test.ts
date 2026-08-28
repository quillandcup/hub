import { describe, it, expect } from "vitest";
import { CONVERSATION_STARTERS, pickConversationStarter } from "@/lib/wheel-of-wonder-starters";

describe("CONVERSATION_STARTERS", () => {
  it("has at least 10 distinct, non-empty prompts", () => {
    expect(CONVERSATION_STARTERS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CONVERSATION_STARTERS).size).toBe(CONVERSATION_STARTERS.length);
    for (const starter of CONVERSATION_STARTERS) {
      expect(starter.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("pickConversationStarter", () => {
  it("returns a member of the starter list", () => {
    const picked = pickConversationStarter(() => 0.5);
    expect(CONVERSATION_STARTERS).toContain(picked);
  });

  it("picks the first starter for rng() = 0", () => {
    expect(pickConversationStarter(() => 0)).toBe(CONVERSATION_STARTERS[0]);
  });

  it("picks the last starter for rng() just under 1", () => {
    expect(pickConversationStarter(() => 0.9999)).toBe(
      CONVERSATION_STARTERS[CONVERSATION_STARTERS.length - 1]
    );
  });
});
