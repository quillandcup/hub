import { describe, expect, it } from "vitest";
import { STYLE_DEFAULTS, faviconProblem, hasStyleOverride, normalizeStyle, normalizeStyleOverride, pageOverrides, resolveFaviconAssetId, resolveStyle, styleClasses } from "@/lib/landing/style";

describe("normalizeStyle", () => {
  it("gives the defaults for anything that isn't a style, and keeps each valid token", () => {
    for (const value of [null, undefined, "x", 3, [], {}]) expect(normalizeStyle(value)).toEqual(STYLE_DEFAULTS);
    expect(normalizeStyle({ primary: "teal", fontFamily: "serif" })).toEqual({ ...STYLE_DEFAULTS, primary: "teal", fontFamily: "serif" });
  });

  it("refuses a value that isn't on the token's list, so no colour or font can be free text", () => {
    expect(normalizeStyle({ primary: "#ff0000", fontFamily: "Comic Sans", buttonSize: "huge", pageBackground: "red" })).toEqual(STYLE_DEFAULTS);
    expect(normalizeStyle({ primary: { toString: () => "teal" } })).toEqual(STYLE_DEFAULTS);
  });
});

describe("normalizeStyleOverride", () => {
  it("keeps only the tokens a page sets, and nothing at all is no override", () => {
    expect(normalizeStyleOverride({ primary: "brown", fontWeight: "bogus", extra: 1 })).toEqual({ primary: "brown" });
    for (const value of [null, undefined, {}, [], "x", { primary: "nope" }]) expect(normalizeStyleOverride(value)).toBeNull();
    expect(hasStyleOverride({ lineHeight: "tight" })).toBe(true);
    expect(hasStyleOverride({})).toBe(false);
  });
});

describe("resolveStyle: which value a page is drawn with", () => {
  const site = { ...STYLE_DEFAULTS, pageBackground: "cream", primary: "teal", fontFamily: "serif" } as const;

  it("with no override, is the site's style", () => {
    expect(resolveStyle(site)).toEqual(site);
    expect(resolveStyle(site, undefined)).toEqual(site);
    expect(resolveStyle(site, {})).toEqual(site);
  });

  it("before the site has any style, is the defaults", () => {
    expect(resolveStyle(null)).toEqual(STYLE_DEFAULTS);
    expect(resolveStyle(undefined, { primary: "brown" })).toEqual({ ...STYLE_DEFAULTS, primary: "brown" });
  });

  it("with a partial override, takes the page's tokens and the site's for the rest", () => {
    expect(resolveStyle(site, { primary: "brown", buttonRadius: "square" })).toEqual({ ...site, primary: "brown", buttonRadius: "square" });
  });

  it("with a full override, ignores the site's style", () => {
    const own = { ...STYLE_DEFAULTS, pageBackground: "blush", primary: "charcoal", fontFamily: "classic" } as const;
    expect(resolveStyle(site, own)).toEqual(own);
  });

  it("when the override is taken away, follows the site again, and follows it when the site changes later", () => {
    const withOverride = resolveStyle(site, { primary: "brown" });
    expect(withOverride.primary).toBe("brown");
    expect(resolveStyle(site, undefined).primary).toBe("teal");
    const changed = { ...site, primary: "charcoal", fontFamily: "classic" } as const;
    expect(resolveStyle(changed, undefined)).toEqual(changed);
    // A token the page overrides stays its own while the site's other tokens change under it.
    expect(resolveStyle(changed, { primary: "brown" })).toEqual({ ...changed, primary: "brown" });
  });

  it("draws the same from the site's stored JSON as from a normalized style", () => {
    expect(resolveStyle(JSON.parse(JSON.stringify(site)), { primary: "brown" })).toEqual(resolveStyle(site, { primary: "brown" }));
  });
});

describe("styleClasses", () => {
  it("adds nothing for the defaults, so a page without a style is unchanged", () => {
    expect(styleClasses(STYLE_DEFAULTS)).toBe("");
  });

  it("names each chosen token, and a page background brings the light scope with it", () => {
    const classes = styleClasses({ pageBackground: "cream", primary: "brown", buttonSize: "large", buttonRadius: "square", fontFamily: "serif", fontWeight: "medium", lineHeight: "relaxed" }).split(" ");
    expect(classes).toEqual(["landing-light", "lp-bg-cream", "lp-primary-brown", "lp-btn-size-large", "lp-btn-radius-square", "lp-font-serif", "lp-weight-medium", "lp-leading-relaxed"]);
  });
});

describe("the favicon", () => {
  it("is the page's own when it has one, the site's otherwise, and an own empty one means none", () => {
    expect(resolveFaviconAssetId("mda_SITE", undefined)).toBe("mda_SITE");
    expect(resolveFaviconAssetId("mda_SITE", "mda_OWN")).toBe("mda_OWN");
    expect(resolveFaviconAssetId("mda_SITE", "")).toBe("");
    expect(resolveFaviconAssetId(null, undefined)).toBe("");
    expect(resolveFaviconAssetId(undefined, 7)).toBe("");
  });

  it("reads a page's overrides from its root", () => {
    expect(pageOverrides({ content: [], root: { props: { styleOverride: { primary: "brown" }, faviconOverrideAssetId: "mda_OWN" } } })).toEqual({ style: { primary: "brown" }, favicon: "mda_OWN" });
    expect(pageOverrides({ content: [], root: {} })).toEqual({ style: undefined, favicon: undefined });
    expect(pageOverrides(null)).toEqual({ style: undefined, favicon: undefined });
  });

  it("accepts a square PNG from 32 to 512 pixels, and says why it refuses anything else", () => {
    expect(faviconProblem({ mime_type: "image/png", width: 32, height: 32 })).toBeNull();
    expect(faviconProblem({ mime_type: "image/png", width: 512, height: 512 })).toBeNull();
    expect(faviconProblem({ width: 64, height: 64 })).toBeNull();
    expect(faviconProblem({ mime_type: "image/jpeg", width: 64, height: 64 })).toContain("PNG");
    expect(faviconProblem({ mime_type: null, width: 64, height: 64 })).toContain("PNG");
    expect(faviconProblem({ mime_type: "image/png", width: 64, height: 32 })).toBe("A favicon has to be square. That picture is 64 by 32 pixels.");
    expect(faviconProblem({ mime_type: "image/png", width: 16, height: 16 })).toContain("at least 32 by 32");
    expect(faviconProblem({ mime_type: "image/png", width: 1024, height: 1024 })).toContain("no larger than 512");
    expect(faviconProblem({ mime_type: "image/png", width: null, height: null })).toContain("no size");
  });
});
