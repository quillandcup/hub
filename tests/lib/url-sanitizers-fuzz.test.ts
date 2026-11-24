import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { allowedHtmlHref, allowedHtmlImageSrc } from "@/lib/sanitize-urls";
import { IMAGE_ROUTE_PREFIXES } from "@/lib/courses/image-urls";
import { safeUrl } from "@/lib/url";

// Property-based tests (fast-check) over the functions that decide which member-supplied addresses reach a page.
// Whatever string arrives, these properties must hold. The fuzzer also biases toward hostile fragments.
const hostile = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc
    .array(
      fc.constantFrom("javascript:", "data:", "vbscript:", "//", "\\", "..", "/api/", "%2e", "%2f", "%5c", "\t", "\n", " ", "http://", "https://", "mailto:", "#", "?", "/", "a"),
      { maxLength: 8 },
    )
    .map((parts) => parts.join("")),
);

// eslint-disable-next-line no-control-regex -- the property is that none survive
const CONTROL = /[\u0000-\u001f\u007f]/;

describe("allowedHtmlHref (fuzz)", () => {
  it("returns an empty string or a clean, non-script, non-API address", () => {
    fc.assert(
      fc.property(hostile, (input) => {
        const out = allowedHtmlHref(input);
        if (out === "") return;
        expect(out).toBe(input.trim());
        expect(CONTROL.test(out)).toBe(false);
        expect(/^(javascript|data|vbscript):/i.test(out)).toBe(false);
        expect(/^\/api(\/|$|[?#])/i.test(out)).toBe(false);
        expect(out.startsWith("//")).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

describe("allowedHtmlImageSrc (fuzz)", () => {
  it("returns an empty string, an http(s) address, or a path under an image route", () => {
    fc.assert(
      fc.property(hostile, (input) => {
        const out = allowedHtmlImageSrc(input);
        if (out === "") return;
        expect(CONTROL.test(out)).toBe(false);
        const allowed = /^https?:\/\//i.test(out) || IMAGE_ROUTE_PREFIXES.some((prefix) => out.startsWith(prefix));
        expect(allowed).toBe(true);
        // A path on this site never climbs out of its prefix.
        if (!/^https?:\/\//i.test(out)) expect(out.split(/[?#]/)[0].split("/")).not.toContain("..");
      }),
      { numRuns: 500 },
    );
  });
});

describe("safeUrl (fuzz)", () => {
  it("returns null or the input unchanged, and only for http(s)", () => {
    fc.assert(
      fc.property(hostile, (input) => {
        const out = safeUrl(input);
        if (out === null) return;
        expect(out).toBe(input);
        expect(["http:", "https:"]).toContain(new URL(out).protocol);
      }),
      { numRuns: 500 },
    );
  });

  it("accepts every well-formed http(s) URL", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(safeUrl(url)).toBe(url);
      }),
      { numRuns: 200 },
    );
  });
});
