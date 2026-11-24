/** The placeholder registry and its resolver (the {year} tokens of footer text among them): the org's year, never the server's, and rolled over without a deploy. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOOTER_TEXT_PLACEHOLDERS, PLACEHOLDERS, currentOrgYear, joinPlaceholders, placeholderDef, placeholderToken, placeholdersFor, resolvePlaceholders, splitPlaceholders } from "@/lib/landing/placeholders";
import { clock } from "@/lib/clock";
import { useFakeClock } from "../helpers/fake-clock";

// 23:30 on 31 December 2026 in Eastern (UTC-5) is 04:30 UTC on 1 January 2027; 00:30 on 1 January is 05:30 UTC.
const NEW_YEARS_EVE_2330_ET = Date.UTC(2027, 0, 1, 4, 30);
const NEW_YEAR_0030_ET = Date.UTC(2027, 0, 1, 5, 30);
const NOV_2026 = Date.UTC(2026, 10, 23, 15, 0);

describe("resolvePlaceholders", () => {
  it("uses the Eastern year, so New Year's Eve evening has not flipped on a UTC server", () => {
    expect(currentOrgYear(NEW_YEARS_EVE_2330_ET)).toBe(2026);
    expect(resolvePlaceholders("© {year} Fern Quills", { nowMs: NEW_YEARS_EVE_2330_ET })).toBe("© 2026 Fern Quills");
    expect(resolvePlaceholders("© {year:2019} Fern Quills", { nowMs: NEW_YEARS_EVE_2330_ET })).toBe("© 2019–2026 Fern Quills");
  });

  it("flips at midnight Eastern", () => {
    expect(resolvePlaceholders("© {year}", { nowMs: NEW_YEAR_0030_ET })).toBe("© 2027");
    expect(resolvePlaceholders("© {year:2019}", { nowMs: NEW_YEAR_0030_ET })).toBe("© 2019–2027");
  });

  it("shows one year when the start year is this year, or later", () => {
    expect(resolvePlaceholders("{year:2026}", { nowMs: NOV_2026 })).toBe("2026");
    expect(resolvePlaceholders("{year:2031}", { nowMs: NOV_2026 })).toBe("2026");
  });

  it("resolves every token in the text", () => {
    expect(resolvePlaceholders("{year} and {year:2020}", { nowMs: NOV_2026 })).toBe("2026 and 2020–2026");
  });

  it("leaves unknown tokens, a malformed start year and plain text as written", () => {
    for (const text of ["© 2026 Fern Quills", "{month}", "{Year}", "{year:19}", "{year:abcd}", "{year:2019-2020}", "{year", "{ year }"]) {
      expect(resolvePlaceholders(text, { nowMs: NOV_2026 })).toBe(text);
    }
  });
});

describe("splitPlaceholders and joinPlaceholders", () => {
  it("splits text into pieces and known placeholders, and joining gives the text back exactly", () => {
    const text = "© {year:2019} Quill & Cup, {year}";
    expect(splitPlaceholders(text)).toEqual([
      { kind: "text", text: "© " },
      { kind: "placeholder", name: "year", param: "2019" },
      { kind: "text", text: " Quill & Cup, " },
      { kind: "placeholder", name: "year" },
    ]);
    expect(joinPlaceholders(splitPlaceholders(text))).toBe(text);
  });

  it("keeps an unknown or invalid {...} as plain text, so nothing is lost", () => {
    for (const text of ["{member} {year:19}", "{year:2019:2020}", "{year:}", "}{year{", "{year}}", "{{year}"]) {
      expect(joinPlaceholders(splitPlaceholders(text))).toBe(text);
    }
    expect(splitPlaceholders("{member}")).toEqual([{ kind: "text", text: "{member}" }]);
    expect(splitPlaceholders("{year:abcd}")).toEqual([{ kind: "text", text: "{year:abcd}" }]);
    expect(splitPlaceholders("")).toEqual([]);
  });

  it("writes a token the way it is stored", () => {
    expect(placeholderToken("year")).toBe("{year}");
    expect(placeholderToken("year", null)).toBe("{year}");
    expect(placeholderToken("year", "2019")).toBe("{year:2019}");
  });
});

describe("the registry", () => {
  const source = readFileSync("tests/lib/landing-placeholders.test.ts", "utf8");

  it.each(PLACEHOLDERS.map((p) => [p.name, p] as const))("%s has a name, a label, a description, an example and a resolver test", (name, def) => {
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(def.label.trim()).not.toBe("");
    expect(def.description.trim()).not.toBe("");
    expect(def.pillLabel().trim()).not.toBe("");
    expect(def.example({ nowMs: NOV_2026 }).trim()).not.toBe("");
    // The example is what the bare token resolves to.
    expect(resolvePlaceholders(placeholderToken(name), { nowMs: NOV_2026 })).toBe(def.example({ nowMs: NOV_2026 }));
    if (def.param) {
      expect(def.param.parse(def.param.sample)).not.toBeNull();
      expect(def.param.parse("")).toBeNull();
      expect(resolvePlaceholders(placeholderToken(name, def.param.sample), { nowMs: NOV_2026 })).not.toBe(placeholderToken(name, def.param.sample));
      expect(def.pillLabel(def.param.sample)).not.toBe(def.pillLabel());
    }
    // A resolver test names the token in this file: add one when you add an entry.
    expect(source).toContain(`{${name}`);
  });

  it("has every opted-in field take its list from the registry: no literal names, only placeholdersFor or a *_PLACEHOLDERS constant", () => {
    const files = ["src/components/landing/editor-config.tsx", "src/app/(admin)/admin/pages/design/DesignEditor.tsx"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const uses = [...text.matchAll(/placeholderText\(\s*"[^"]*",\s*([^)]+)\)|placeholders=\{([^}]+)\}/g)].map((m) => (m[1] ?? m[2]).trim());
      expect(uses.length, file).toBeGreaterThan(0);
      for (const arg of uses) expect(arg, file).toMatch(/^(placeholdersFor\("[a-z-]+"\)|[A-Z_]+_PLACEHOLDERS)$/);
    }
  });

  it("has unique names", () => {
    expect(new Set(PLACEHOLDERS.map((p) => p.name)).size).toBe(PLACEHOLDERS.length);
    expect(placeholderDef("year")?.name).toBe("year");
    expect(placeholderDef("nope")).toBeUndefined();
  });

  it("offers each surface the entries that list it, so a new entry reaches every field of that surface", () => {
    expect(placeholdersFor("footer")).toEqual(PLACEHOLDERS.filter((p) => (p.surfaces as readonly string[]).includes("footer")).map((p) => p.name));
    expect(FOOTER_TEXT_PLACEHOLDERS).toEqual(placeholdersFor("footer"));
    expect(FOOTER_TEXT_PLACEHOLDERS).toContain("year");
    for (const name of FOOTER_TEXT_PLACEHOLDERS) expect(placeholderDef(name)).toBeDefined();
  });
});

describe("resolvePlaceholders with the app clock", () => {
  const fake = useFakeClock(() => NEW_YEARS_EVE_2330_ET);

  it("reads src/lib/clock, so the year rolls over as time moves", () => {
    expect(resolvePlaceholders("{year}")).toBe("2026");
    fake.clock.advance(60 * 60 * 1000);
    expect(clock.now()).toBe(NEW_YEARS_EVE_2330_ET + 3600_000);
    expect(resolvePlaceholders("{year}")).toBe("2027");
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
