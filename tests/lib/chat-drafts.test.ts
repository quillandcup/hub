import { describe, expect, it } from "vitest";
import { fromDraftBody, toDraftBody } from "@/lib/chat/drafts";

describe("draft bodies", () => {
  it("labels each mention with the name shown", () => {
    const tokens = new Map([["@Ania Ray", "<@U1>"], ["#general", "<#C1>"]]);
    expect(toDraftBody("hi @Ania Ray, see #general", tokens)).toBe("hi <@U1|Ania Ray>, see <#C1|general>");
  });

  it("shows a stored mention by name again and keeps the markup to send without the label", () => {
    const { text, tokens } = fromDraftBody("hi <@U1|Ania Ray>, see <#C1|general>");
    expect(text).toBe("hi @Ania Ray, see #general");
    expect(tokens.get("@Ania Ray")).toBe("<@U1>");
    expect(tokens.get("#general")).toBe("<#C1>");
  });

  it("keeps characters that Slack escapes as typed", () => {
    expect(toDraftBody("a < b & c", new Map())).toBe("a < b & c");
    expect(fromDraftBody("a < b & c").text).toBe("a < b & c");
  });
});
