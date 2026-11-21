import { describe, expect, it } from "vitest";
import { STYLE_DEFAULTS } from "@/lib/landing/style";
import { EMPTY_SITE_TEMPLATE, SITE_ITEMS_MAX, SITE_LINKS_MAX, SIGN_IN_HREF, newHeaderItem, normalizeSiteTemplate, siteAssetIds, siteTemplateIssues } from "@/lib/landing/site-template";

describe("normalizeSiteTemplate", () => {
  it("gives an empty, off site for anything that isn't a document", () => {
    for (const value of [null, undefined, "x", 3, [], {}]) expect(normalizeSiteTemplate(value)).toEqual(EMPTY_SITE_TEMPLATE);
  });

  it("keeps a complete document as it is", () => {
    const site = {
      header: { show: true, align: "center", mobileMenu: "wrap", items: [newHeaderItem("logo"), newHeaderItem("menu"), newHeaderItem("cta"), newHeaderItem("social"), newHeaderItem("signin")] },
      footer: { show: true, text: "Fern Quills", links: [{ label: "Privacy", href: "/privacy" }], social: [{ network: "youtube", href: "https://example.test/c" }] },
      style: { ...STYLE_DEFAULTS, primary: "teal", fontFamily: "serif" },
      favicon: { assetId: "mda_AAAAAAAAAAA1" },
    };
    expect(normalizeSiteTemplate(JSON.parse(JSON.stringify(site)))).toEqual(site);
  });

  it("clamps choices to their lists, drops unknown blocks, cleans links and caps the sizes", () => {
    const site = normalizeSiteTemplate({
      header: {
        show: "yes",
        align: "sideways",
        mobileMenu: "hide",
        items: [
          { id: "a", type: "cta", label: "Join", href: "javascript:alert(1)", look: "huge", show: "never" },
          { id: "b", type: "script", html: "<script>" },
          { type: "menu", links: Array.from({ length: SITE_LINKS_MAX + 5 }, (_, i) => ({ label: `L${i}`, href: i === 0 ? "//evil.test" : "/ok" })) },
          { id: "c", type: "social", links: [{ network: "myspace", href: "https://example.test" }] },
          ...Array.from({ length: SITE_ITEMS_MAX + 4 }, () => ({ type: "signin", label: "In" })),
        ],
      },
      footer: { show: true, text: `a\u0000b${"x".repeat(500)}`, extra: "ignored" },
    });
    expect(site.header.show).toBe(false);
    expect(site.header.align).toBe("spread");
    expect(site.header.mobileMenu).toBe("fold");
    expect(site.header.items).toHaveLength(SITE_ITEMS_MAX);
    expect(site.header.items[0]).toMatchObject({ type: "cta", href: "", look: "solid", show: "both" });
    expect(site.header.items[1]).toMatchObject({ type: "menu", links: expect.any(Array) });
    expect((site.header.items[1] as { links: { href: string }[] }).links).toHaveLength(SITE_LINKS_MAX);
    expect((site.header.items[1] as { links: { href: string }[] }).links[0].href).toBe("");
    expect(site.header.items[2]).toMatchObject({ type: "social", links: [{ network: "instagram", href: "https://example.test" }] });
    expect(site.footer.text).toHaveLength(300);
    expect(site.footer.text).not.toContain("\u0000");
    expect(site).not.toHaveProperty("extra");
  });
});

describe("the site template's pictures and checks", () => {
  it("lists the logo's picture once, to be made public with the template", () => {
    const logo = { ...newHeaderItem("logo"), logoAssetId: "mda_AAAAAAAAAAA1" };
    const site = normalizeSiteTemplate({ header: { show: true, items: [logo, { ...logo, id: "other" }, newHeaderItem("menu")] } });
    expect(siteAssetIds(site)).toEqual(["mda_AAAAAAAAAAA1"]);
    expect(siteAssetIds(EMPTY_SITE_TEMPLATE)).toEqual([]);
  });

  it("stops a publish on what a visitor would meet broken, each problem once", () => {
    const site = normalizeSiteTemplate({
      header: { show: true, items: [{ id: "l", type: "logo", logoAssetId: "mda_AAAAAAAAAAA1", alt: "" }, { id: "c", type: "cta", label: "", href: "" }, { id: "s", type: "signin", label: "" }, { id: "m", type: "menu", links: [{ label: "A", href: "" }, { label: "", href: "/b" }] }, { id: "o", type: "social", links: [{ network: "instagram", href: "" }] }] },
      footer: { show: true, links: [{ label: "Privacy", href: "" }], social: [{ network: "x", href: "" }] },
    });
    expect(siteTemplateIssues(site)).toEqual([
      "The logo needs a description (what it says), for people who can't see it.",
      "The header button needs a label and a link.",
      "The sign-in link needs a label.",
      "Every menu link needs a label and a link.",
      "Every social link needs a link.",
      "Every footer link needs a label and a link.",
      "Every footer social link needs a link.",
    ]);
    expect(siteTemplateIssues(EMPTY_SITE_TEMPLATE)).toEqual([]);
  });

  it("points the sign-in link at the member sign-in page", () => {
    expect(SIGN_IN_HREF).toBe("/login");
  });
});
