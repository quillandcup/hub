import { describe, expect, it } from "vitest";
import { MAX_SLUG } from "@/lib/courses/editor";
import { addressFromTitle, suggestAddress } from "@/lib/courses/address-suggestion";

describe("addressFromTitle", () => {
  it("is the address the editor derives from a name, cut to fit", () => {
    expect(addressFromTitle("The Ready Writer")).toBe("the-ready-writer");
    expect(addressFromTitle("A".repeat(80))).toHaveLength(MAX_SLUG);
    expect(addressFromTitle("word ".repeat(30)).endsWith("-")).toBe(false);
    expect(addressFromTitle("!!!")).toBe("");
  });
});

describe("suggestAddress", () => {
  it("suggests the new name's address when the address was following the old name", () => {
    expect(suggestAddress({ baselineTitle: "Draft Course", title: "Finish Your Novel", slug: "draft-course" })).toBe("finish-your-novel");
  });

  it("leaves an address someone chose by hand alone", () => {
    expect(suggestAddress({ baselineTitle: "Draft Course", title: "Finish Your Novel", slug: "novel-bootcamp" })).toBeNull();
  });

  it("suggests nothing when the name still gives the address it has, or there is no name or address", () => {
    expect(suggestAddress({ baselineTitle: "Draft Course", title: "Draft Course", slug: "draft-course" })).toBeNull();
    expect(suggestAddress({ baselineTitle: "Draft Course", title: "", slug: "draft-course" })).toBeNull();
    expect(suggestAddress({ baselineTitle: "Draft Course", title: "New", slug: "  " })).toBeNull();
  });

  it("replaces a duplicate's placeholder once the name loses its (copy)", () => {
    const base = { baselineTitle: "The Ready Writer (copy)" };
    expect(suggestAddress({ ...base, title: "The Ready Writer (copy)", slug: "the-ready-writer-copy" })).toBeNull();
    expect(suggestAddress({ ...base, title: "Ready Writer Two", slug: "the-ready-writer-copy" })).toBe("ready-writer-two");
    // A numbered placeholder too, which no longer matches the name's own address.
    expect(suggestAddress({ ...base, title: "Ready Writer Two", slug: "the-ready-writer-copy-2" })).toBe("ready-writer-two");
    // ...but not while the name still says copy.
    expect(suggestAddress({ ...base, title: "The Ready Writer (copy) 2", slug: "the-ready-writer-copy-2" })).toBeNull();
  });

  it("follows the last name a suggestion was taken for", () => {
    // After "Use ready-writer-two" the form's baseline is that name; renaming again offers the next address.
    expect(suggestAddress({ baselineTitle: "Ready Writer Two", title: "Ready Writer Three", slug: "ready-writer-two" })).toBe("ready-writer-three");
  });
});
