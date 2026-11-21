import { describe, it, expect } from "vitest";
import { allowedBlocks, childrenIn, findItem, isContainer, moveOf, rowOf, slotsOf, summaryOf, zoneOf } from "@/app/(admin)/admin/pages/[slug]/outline-tree";
import { ITEM_BLOCKS, SLOT_ALLOW } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";

const config = {
  components: {
    Section: { fields: { content: { type: "slot", disallow: ["Step"] } } },
    Columns: { fields: { col1: { type: "slot" }, col2: { type: "slot", label: "Right" } } },
    Steps: { label: "How it works", fields: { items: { type: "slot", allow: ["Step"] } } },
    Step: {},
    Heading: { fields: { text: { type: "text" } } },
  },
};
const item = (type: string, props: Record<string, unknown>) => ({ type, props: { id: String(props.id), ...props } }) as never;

describe("slotsOf and isContainer", () => {
  it("finds a block's slots in field order, naming unlabelled columns", () => {
    expect(slotsOf(config, "Columns").map((s) => [s.key, s.label])).toEqual([["col1", "Column 1"], ["col2", "Right"]]);
    expect(slotsOf(config, "Section")[0]).toMatchObject({ key: "content", label: "content", disallow: ["Step"] });
    expect(slotsOf(config, "Heading")).toEqual([]);
    expect(slotsOf(config, "Nope")).toEqual([]);
    expect(isContainer(config, "Steps")).toBe(true);
    expect(isContainer(config, "Heading")).toBe(false);
  });

  it("finds every slot block of the real editor config, so a new container or item list needs no change here", () => {
    const withSlots = Object.keys(editorConfig.components).filter((name) => isContainer(editorConfig, name));
    for (const name of Object.keys(SLOT_ALLOW)) expect(withSlots).toContain(name);
    expect(withSlots).toEqual(expect.arrayContaining(["Section", "Columns"]));
    for (const [name, slots] of Object.entries(SLOT_ALLOW)) {
      const slot = slotsOf(editorConfig, name).find((s) => s.key === "items");
      expect(allowedBlocks(editorConfig, slot!)).toEqual(Object.values(slots!).flat());
    }
  });
});

describe("allowedBlocks", () => {
  it("narrows by allow and disallow, and the page's top level leaves out the parts of blocks", () => {
    expect(allowedBlocks(config, { allow: ["Step"] })).toEqual(["Step"]);
    expect(allowedBlocks(config, { disallow: ["Step"] })).toEqual(["Section", "Columns", "Steps", "Heading"]);
    expect(allowedBlocks(config, {})).toHaveLength(5);
    expect(allowedBlocks(config, null, ["Step"])).toEqual(["Section", "Columns", "Steps", "Heading"]);
  });

  it("a Section in the real config takes everything but the item blocks", () => {
    const section = slotsOf(editorConfig, "Section")[0];
    const allowed = allowedBlocks(editorConfig, section);
    for (const part of ITEM_BLOCKS) expect(allowed).not.toContain(part);
    expect(allowed).toContain("Heading");
  });
});

describe("rows", () => {
  it("summarises a block by its own text, without markup, and shortens it", () => {
    expect(summaryOf(item("Heading", { id: "a", text: "Welcome" }))).toBe("Welcome");
    expect(summaryOf(item("RichText", { id: "a", html: "<p>Hello <b>there</b></p>" }))).toBe("Hello there");
    expect(summaryOf(item("Heading", { id: "a", text: "x".repeat(60) }))).toHaveLength(36);
    expect(summaryOf(item("Spacer", { id: "a", size: "medium" }))).toBe("");
    expect(summaryOf(item("Heading", { id: "a", text: "  " }))).toBe("");
  });

  it("makes a row with the config's label, and marks containers", () => {
    expect(rowOf(config, item("Steps", { id: "s", items: [] }))).toEqual({ id: "s", type: "Steps", label: "How it works", summary: "", container: true });
    expect(rowOf(config, item("Heading", { id: "h", text: "Hi" }))).toMatchObject({ label: "Heading", summary: "Hi", container: false });
  });

  it("reads a slot's blocks, and nothing for a slot that is not a list", () => {
    const s = item("Section", { id: "s", content: [item("Heading", { id: "h" })], other: "x" });
    expect(childrenIn(s, "content")).toHaveLength(1);
    expect(childrenIn(s, "other")).toEqual([]);
    expect(childrenIn(s, "missing")).toEqual([]);
    expect(zoneOf("s", "content")).toBe("s:content");
  });

  it("finds a block anywhere in the page", () => {
    const deep = item("Heading", { id: "deep" });
    const content = [item("Section", { id: "s", content: [item("Columns", { id: "c", col1: [], col2: [deep] })] })];
    expect(findItem(config, content, "deep")).toBe(deep);
    expect(findItem(config, content, "c")?.type).toBe("Columns");
    expect(findItem(config, content, "nope")).toBeUndefined();
  });
});

describe("moveOf", () => {
  it("tells where one item went, down or up", () => {
    expect(moveOf(["a", "b", "c"], ["b", "c", "a"])).toEqual({ from: 0, to: 2 });
    expect(moveOf(["a", "b", "c"], ["c", "a", "b"])).toEqual({ from: 2, to: 0 });
    expect(moveOf(["a", "b", "c", "d"], ["a", "c", "b", "d"])).toEqual({ from: 1, to: 2 });
  });

  it("is null when nothing moved, or the lists are not a single move", () => {
    expect(moveOf(["a", "b"], ["a", "b"])).toBeNull();
    expect(moveOf(["a", "b"], ["a"])).toBeNull();
    expect(moveOf(["a", "b", "c", "d"], ["b", "a", "d", "c"])).toBeNull();
  });
});
