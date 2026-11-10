import { describe, it, expect } from "vitest";
import { canStartDirectMessage } from "@/lib/chat/can-message";

describe("canStartDirectMessage", () => {
  it("needs the Slack DM bridge or Hub direct messages", () => {
    expect(canStartDirectMessage({ isSudo: false }, [])).toBe(false);
    expect(canStartDirectMessage({ isSudo: false }, ["big_sisters"])).toBe(false);
    expect(canStartDirectMessage({ isSudo: false }, ["slack_dm_bridge"])).toBe(true);
    expect(canStartDirectMessage({ isSudo: false }, ["chat_dms"])).toBe(true);
  });

  it("is never offered in sudo, which is read-only", () => {
    expect(canStartDirectMessage({ isSudo: true }, ["slack_dm_bridge", "chat_dms"])).toBe(false);
  });
});
