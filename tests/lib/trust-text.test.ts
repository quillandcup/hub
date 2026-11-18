import { describe, expect, it } from "vitest";
import { plainText, richParts } from "@/lib/trust-text";
import { COMPLIANCE_GROUPS, COMPLIANCE_PROVIDERS } from "@/lib/compliance";
import { SECURITY_GROUPS } from "@/lib/security";

describe("richParts links the trust pages", () => {
  it("turns each mention of the Privacy, Compliance and Security page into a link, and keeps the words around it", () => {
    expect(richParts("The full detail is on the Privacy page.")).toEqual([
      "The full detail is on the ",
      { link: "/privacy", text: "Privacy page" },
      ".",
    ]);
    expect(richParts("See the Security page and the Compliance page")).toEqual([
      "See the ",
      { link: "/security", text: "Security page" },
      " and the ",
      { link: "/compliance", text: "Compliance page" },
    ]);
  });

  it("leaves text with no page name alone, and does not link a lower-case or longer phrase", () => {
    expect(richParts("Nothing to link here")).toEqual(["Nothing to link here"]);
    expect(richParts("a privacy page of our own, the Privacy pages")).toEqual(["a privacy page of our own, the Privacy pages"]);
  });

  it("links inside a list of parts, and leaves bold words and existing links as they are", () => {
    const parts = richParts([{ strong: "Bold" }, " and the Privacy page, ", { link: "/x", text: "x" }]);
    expect(parts).toEqual([{ strong: "Bold" }, " and the ", { link: "/privacy", text: "Privacy page" }, ", ", { link: "/x", text: "x" }]);
  });

  it("does not change the plain words a staff list or a test reads", () => {
    const text = "The full detail is on the Privacy page, and the Security page has the rest.";
    expect(plainText(text)).toBe(text);
  });
});

describe("every mention of another trust page in the lists is plain text the helper links", () => {
  const texts = [
    ...COMPLIANCE_GROUPS.flatMap((g) => [g.intro, ...g.items.flatMap((i) => [i.detail, ...i.open])]),
    ...COMPLIANCE_PROVIDERS.map((p) => p.covers),
    ...SECURITY_GROUPS.flatMap((g) => [g.intro, ...g.items.flatMap((i) => [i.member, i.staff.how, ...i.staff.open])]),
  ];

  it("has such mentions, so the links are exercised", () => {
    expect(texts.filter((t) => /(Privacy|Compliance|Security) page/.test(t)).length).toBeGreaterThan(2);
  });

  it("each is a string, so none escapes the linking", () => {
    for (const t of texts) expect(typeof t).toBe("string");
  });
});
