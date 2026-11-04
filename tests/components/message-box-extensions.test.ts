// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { messageBoxExtensions } from "@/components/chat/message-box-extensions";

describe("messageBoxExtensions", () => {
  it("registers no extra link scheme: mailto is one of linkify's own, and registering a scheme after linkify has started (a second box opening) logs a warning", () => {
    const starter = messageBoxExtensions(4000).find((e) => e.name === "starterKit");
    const link = (starter?.options as { link?: { protocols?: unknown[] } }).link;
    expect(link).toBeDefined();
    expect(link?.protocols ?? []).toEqual([]);
  });
});
