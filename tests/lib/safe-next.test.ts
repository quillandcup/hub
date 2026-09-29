import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/prickles/123?tab=attendance#notes", "/prickles/123?tab=attendance#notes"],
    ["/members/a%2Fb", "/members/a%2Fb"],
    ["/writing/../dashboard", "/dashboard"],
  ])("keeps same-origin path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "@evil.example",
    "evil.example",
    "javascript:alert(1)",
    "/%0d%0aSet-Cookie:x=y".replace("%0d%0a", "\r\n"),
    "/\tevil",
    " /dashboard",
    "",
    "/" + "a".repeat(2048),
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it.each(["/login", "/login?x=1", "/auth/callback", "/auth/slack?token=t"])(
    "rejects sign-in pages so they can't loop: %s",
    (raw) => {
      expect(safeNextPath(raw)).toBeNull();
    }
  );
});
