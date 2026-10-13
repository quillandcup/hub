import { describe, it, expect } from "vitest";
import { parseUniversal, hasCriteria, suggestOperators, resolveKind, withKind } from "@/lib/search/syntax";

describe("parseUniversal", () => {
  it("passes plain words and chat operators through to the chat parser", () => {
    const q = parseUniversal('from:@fern "pizza night" -onions after:2026-10-01');
    expect(q).toMatchObject({ from: "fern", after: "2026-10-02T00:00:00.000Z" });
    expect(q.tsquery).toBe("('pizza' <-> 'night') & !('onions')");
  });

  it("reads in: as the kind (kind: and type: too), and keeps the rest as words", () => {
    expect(parseUniversal("in:members cody")).toMatchObject({ kind: "members", tsquery: "('cody')" });
    expect(parseUniversal("kind:members cody").kind).toBe("members");
    expect(parseUniversal("in:prickles").inChannel).toBeUndefined();
    expect(parseUniversal("type:person cody").kind).toBe("members");
    expect(parseUniversal("kind:badge x").kind).toBe("badges");
    expect(parseUniversal("in:channel gen").kind).toBe("channels");
  });

  it("channel: picks a chat channel, and in:#name still does too", () => {
    expect(parseUniversal("channel:general pizza")).toMatchObject({ inChannel: "general" });
    expect(parseUniversal("in:#general pizza")).toMatchObject({ inChannel: "general" });
  });

  it("flags an unknown kind instead of searching for the words", () => {
    const q = parseUniversal("in:nonsense cody");
    expect(q.kind).toBeUndefined();
    expect(q.unknownKind).toBe("nonsense");
    expect(q.tsquery).toBe("('cody')");
  });

  it("reads email: and status: for members", () => {
    expect(parseUniversal("in:members email:@example.org status:Active")).toMatchObject({ email: "example.org", status: "active" });
  });

  it("does not treat operator-looking text inside a phrase as an operator", () => {
    const q = parseUniversal('"in:members"');
    expect(q.kind).toBeUndefined();
  });

  it("hasCriteria is false for empty input and true for filters alone", () => {
    expect(hasCriteria(parseUniversal("   "))).toBe(false);
    expect(hasCriteria(parseUniversal("from:me"))).toBe(true);
    expect(hasCriteria(parseUniversal("in:members"))).toBe(false);
  });
});

describe("operator suggestions", () => {
  it("hides admin-only operators from members", () => {
    expect(suggestOperators("e", false).map((o) => o.name)).toEqual([]);
    expect(suggestOperators("e", true).map((o) => o.name)).toEqual(["email"]);
  });

  it("resolveKind accepts canonical names case-insensitively", () => {
    expect(resolveKind("Prickles")).toBe("prickles");
  });
});

describe("withKind", () => {
  it("replaces an existing scope and keeps channel and phrases", () => {
    expect(withKind('pizza in:members "a b"', "books")).toBe('pizza "a b" in:books');
    expect(withKind("pizza in:#general", "chat")).toBe("pizza in:#general in:chat");
    expect(withKind("pizza kind:books")).toBe("pizza");
  });
});
