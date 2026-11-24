/** The {year} tokens of the site footer text: the org's year, never the server's, and rolled over without a deploy. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentOrgYear, resolveYearTokens } from "@/lib/landing/footer-year";
import { clock } from "@/lib/clock";
import { useFakeClock } from "../helpers/fake-clock";

// 23:30 on 31 December 2026 in Eastern (UTC-5) is 04:30 UTC on 1 January 2027; 00:30 on 1 January is 05:30 UTC.
const NEW_YEARS_EVE_2330_ET = Date.UTC(2027, 0, 1, 4, 30);
const NEW_YEAR_0030_ET = Date.UTC(2027, 0, 1, 5, 30);
const NOV_2026 = Date.UTC(2026, 10, 23, 15, 0);

describe("resolveYearTokens", () => {
  it("uses the Eastern year, so New Year's Eve evening has not flipped on a UTC server", () => {
    expect(currentOrgYear(NEW_YEARS_EVE_2330_ET)).toBe(2026);
    expect(resolveYearTokens("© {year} Fern Quills", NEW_YEARS_EVE_2330_ET)).toBe("© 2026 Fern Quills");
    expect(resolveYearTokens("© {year:2019} Fern Quills", NEW_YEARS_EVE_2330_ET)).toBe("© 2019–2026 Fern Quills");
  });

  it("flips at midnight Eastern", () => {
    expect(resolveYearTokens("© {year}", NEW_YEAR_0030_ET)).toBe("© 2027");
    expect(resolveYearTokens("© {year:2019}", NEW_YEAR_0030_ET)).toBe("© 2019–2027");
  });

  it("shows one year when the start year is this year, or later", () => {
    expect(resolveYearTokens("{year:2026}", NOV_2026)).toBe("2026");
    expect(resolveYearTokens("{year:2031}", NOV_2026)).toBe("2026");
  });

  it("resolves every token in the text", () => {
    expect(resolveYearTokens("{year} and {year:2020}", NOV_2026)).toBe("2026 and 2020–2026");
  });

  it("leaves unknown tokens, a malformed start year and plain text as written", () => {
    for (const text of ["© 2026 Fern Quills", "{month}", "{Year}", "{year:19}", "{year:abcd}", "{year:2019-2020}", "{year", "{ year }"]) {
      expect(resolveYearTokens(text, NOV_2026)).toBe(text);
    }
  });
});

describe("resolveYearTokens with the app clock", () => {
  const fake = useFakeClock(() => NEW_YEARS_EVE_2330_ET);

  it("reads src/lib/clock, so the year rolls over as time moves", () => {
    expect(resolveYearTokens("{year}")).toBe("2026");
    fake.clock.advance(60 * 60 * 1000);
    expect(clock.now()).toBe(NEW_YEARS_EVE_2330_ET + 3600_000);
    expect(resolveYearTokens("{year}")).toBe("2027");
  });
});

describe("public pages are not cached across New Year", () => {
  it("the root layout reads request headers and the public page sets no static caching, so the year is resolved on every request", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/await headers\(\)/);
    const page = readFileSync("src/app/p/[slug]/page.tsx", "utf8");
    expect(page).not.toMatch(/export const (revalidate|dynamic)\b/);
    expect(page).not.toMatch(/generateStaticParams/);
  });
});
