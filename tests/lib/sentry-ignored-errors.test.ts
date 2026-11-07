import { describe, expect, it } from "vitest";
import { IGNORED_BROWSER_ERRORS } from "@/lib/sentry-ignored-errors";

const ignored = (message: string) => IGNORED_BROWSER_ERRORS.some((re) => re.test(message));

describe("IGNORED_BROWSER_ERRORS", () => {
  it("drops the extension's sendMessage rejection", () => {
    expect(ignored("Invalid call to runtime.sendMessage(). Tab not found.")).toBe(true);
  });

  it("keeps network errors and anything else", () => {
    expect(ignored("TypeError: Failed to fetch")).toBe(false);
    expect(ignored("network error")).toBe(false);
    expect(ignored("Tab not found")).toBe(false);
  });
});
