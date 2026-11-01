import { describe, expect, it } from "vitest";
import { DEMO_CHANNELS, who } from "@/demo/chat-seed";
import { COMMUNITY } from "@/lib/data/profiles/community";

describe("the demo chat's cast", () => {
  it("names people from the community profile, by key", () => {
    expect(who("member")).toBe(COMMUNITY.people.find((p) => p.key === "member")!.name);
    expect(() => who("nobody")).toThrow(/no person "nobody"/);
  });

  it("only has members of the community post, react and reply", () => {
    const names = new Set(COMMUNITY.people.map((p) => p.name));
    const authors = DEMO_CHANNELS.flatMap((c) =>
      c.messages.flatMap((m) => [m.by, ...(m.reactions ?? []).flatMap((r) => r.by), ...(m.replies ?? []).map((r) => r.by)]),
    );

    expect(authors.length).toBeGreaterThan(20);
    expect(authors.filter((name) => !names.has(name))).toEqual([]);
  });
});
