import { describe, it, expect, beforeEach } from "vitest";
import { actingAsHeaderValue, parseSudoCookie, signSudoCookie } from "@/lib/sudo-cookie";

const ADMIN = "00000000-0000-4000-a000-0000000000a1";
const MEMBER = "00000000-0000-4000-a000-0000000000b1";

beforeEach(() => {
  process.env.SUDO_SECRET = "test-secret";
});

describe("actingAsHeaderValue", () => {
  it("returns admin:member for a validly signed cookie", () => {
    const cookie = signSudoCookie(ADMIN, MEMBER);
    expect(actingAsHeaderValue(cookie)).toBe(`${ADMIN}:${MEMBER}`);
    expect(actingAsHeaderValue(cookie, ADMIN)).toBe(`${ADMIN}:${MEMBER}`);
  });

  it("is null without a cookie, with a tampered one, or for someone else's", () => {
    const cookie = signSudoCookie(ADMIN, MEMBER);
    expect(actingAsHeaderValue(undefined)).toBeNull();
    expect(actingAsHeaderValue(cookie.replace(MEMBER, "00000000-0000-4000-a000-0000000000b2"))).toBeNull();
    expect(actingAsHeaderValue(cookie, "00000000-0000-4000-a000-0000000000a2")).toBeNull();
  });

  it("is null when SUDO_SECRET is missing", () => {
    const cookie = signSudoCookie(ADMIN, MEMBER);
    delete process.env.SUDO_SECRET;
    expect(actingAsHeaderValue(cookie)).toBeNull();
    expect(parseSudoCookie(cookie)).toBeNull();
  });
});
