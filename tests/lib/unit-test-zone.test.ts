import { describe, it, expect } from "vitest";

// The unit project pins a non-UTC zone (vitest.config.mts) so machine-zone dependence shows up in CI.
describe("unit test zone", () => {
  it("runs in the configured zone, not UTC", () => {
    const expected = process.env.UNIT_TEST_TZ ?? "Pacific/Auckland";
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(expected);
  });
});
