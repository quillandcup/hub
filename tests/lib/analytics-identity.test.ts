// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { gaClientIdFromCookie, initialUserIdCommand, setAnalyticsUserId } from "@/lib/analytics-identity";

describe("gaClientIdFromCookie", () => {
  it.each([
    ["GA1.1.1234567890.1700000000", "1234567890.1700000000"],
    ["GA1.2.987654321.1699999999", "987654321.1699999999"],
  ])("reads the browser ID from %s", (cookie, id) => {
    expect(gaClientIdFromCookie(cookie)).toBe(id);
  });

  it.each([null, undefined, "", "GA1.1.abc.123", "GS1.1.1700000000.1.0.0", "GA1.1.123", "x".repeat(100)])(
    "ignores %j",
    (cookie) => {
      expect(gaClientIdFromCookie(cookie)).toBeNull();
    }
  );
});

describe("initialUserIdCommand", () => {
  it("sets the user for a signed-in visitor", () => {
    expect(initialUserIdCommand("11111111-1111-1111-1111-111111111111")).toBe(
      `gtag('set', {"user_id":"11111111-1111-1111-1111-111111111111"});`
    );
  });

  it("sends nothing for an anonymous visitor", () => {
    expect(initialUserIdCommand(null)).toBe("");
  });
});

describe("setAnalyticsUserId", () => {
  afterEach(() => {
    delete window.gtag;
  });

  it("sets or clears GA's user_id", () => {
    window.gtag = vi.fn();
    setAnalyticsUserId("u1");
    setAnalyticsUserId(null);
    expect(window.gtag).toHaveBeenNthCalledWith(1, "set", { user_id: "u1" });
    expect(window.gtag).toHaveBeenNthCalledWith(2, "set", { user_id: null });
  });

  it("does nothing when GA isn't loaded", () => {
    expect(() => setAnalyticsUserId("u1")).not.toThrow();
  });
});
