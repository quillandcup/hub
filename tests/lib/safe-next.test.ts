import { describe, it, expect } from "vitest";
import { isRememberableVisit, safeNextPath } from "@/lib/safe-next";

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

describe("isRememberableVisit", () => {
  const headers = (h: Record<string, string> = {}) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
  const PAGE = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";

  it("remembers a plain page navigation, with or without the browser's fetch metadata", () => {
    expect(isRememberableVisit("GET", headers(), PAGE)).toBe(true);
    expect(isRememberableVisit("GET", headers({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }), PAGE)).toBe(true);
  });

  it.each([
    ["a form post or server action", "POST", {}],
    ["a Next RSC fetch", "GET", { rsc: "1" }],
    ["a router prefetch", "GET", { "next-router-prefetch": "1" }],
    ["a segment prefetch", "GET", { "next-router-segment-prefetch": "/_tree" }],
    ["a background fetch", "GET", { "sec-fetch-mode": "cors" }],
    ["a same-origin fetch", "GET", { "sec-fetch-mode": "same-origin" }],
    ["an image or frame, not a document", "GET", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }],
  ])("doesn't remember %s", (_name, method, h) => {
    expect(isRememberableVisit(method, headers(h), PAGE)).toBe(false);
  });

  it("doesn't remember the bare root, which says nothing (it is where sign-in goes anyway), but remembers a page with a query", () => {
    expect(isRememberableVisit("GET", headers(), "/")).toBe(false);
    expect(isRememberableVisit("GET", headers(), "/?utm=x")).toBe(false);
    expect(isRememberableVisit("GET", headers(), "/dashboard")).toBe(true);
  });
});
