import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { COVER_HEIGHT, COVER_WIDTH, coverPng, coverSvg, wrapTitle } from "@/demo/covers";

describe("demo covers", () => {
  it("wraps a title on spaces", () => {
    expect(wrapTitle("The Lighthouse Bakery Murders")).toEqual(["The Lighthouse", "Bakery Murders"]);
    expect(wrapTitle("Supercalifragilistic")).toEqual(["Supercalifragilistic"]);
  });

  it("escapes text that would break the markup", () => {
    const svg = coverSvg({ title: "Salt & <Sugar>", author: 'A "B"', colors: ["#111", "#222"] });
    expect(svg).toContain("Salt &amp;");
    expect(svg).toContain("&lt;Sugar&gt;");
    expect(svg).not.toContain("<Sugar>");
  });

  it("renders the same bytes twice, at the cover size", async () => {
    const spec = { title: "Tide Tables", author: "Maya Example", colors: ["#3b2a5c", "#c0698a"] as [string, string] };
    const [a, b] = await Promise.all([coverPng(spec), coverPng(spec)]);
    expect(a.equals(b)).toBe(true);
    const meta = await sharp(a).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([COVER_WIDTH, COVER_HEIGHT, "png"]);
  });
});
