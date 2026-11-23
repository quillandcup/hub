import { describe, expect, it } from "vitest";
import { createPageBlockRegistry, definePageBlock, unregisteredTypes, type PageBlockDefinition } from "@/components/landing/block-registry";
import { pageBlocks } from "@/components/landing/config";
import { coreBlocks } from "@/components/landing/core-blocks";
import { eventsPageBlocks } from "@/modules/events/page-blocks";
import { bookshelfPageBlocks } from "@/modules/bookshelf/page-blocks";
import { installedPageBlocks } from "@/modules";

const Nothing = () => null;
const block = (type: string, more: Partial<PageBlockDefinition> = {}) => definePageBlock({ type, label: type, category: "content", order: 10, defaults: {}, render: Nothing, ...more });

const EVENT_TYPES = ["AnnouncementStrip", "SchedulePanel", "ScheduleRow", "ComingUp"];

describe("createPageBlockRegistry", () => {
  it("rejects a type registered twice, naming both owners", () => {
    expect(() => createPageBlockRegistry([{ id: "pages", blocks: [block("Heading")] }, { id: "other", blocks: [block("Heading")] }])).toThrow(/"Heading" \(from "other"\) is already registered by "pages"/);
    expect(() => createPageBlockRegistry([{ id: "pages", blocks: [block("A"), block("A")] }])).toThrow(/already registered by "pages"/);
  });

  it("rejects the same contribution installed twice, which is the same block twice", () => {
    expect(() => createPageBlockRegistry([coreBlocks, coreBlocks])).toThrow(/already registered by "pages"/);
  });

  it.each([
    ["a missing label", block("A", { label: "" }), /needs a label/],
    ["a type that is not a name", block("not a name"), /needs a type made of letters and digits/],
    ["no component", block("A", { render: undefined as never }), /needs a render component/],
    ["no defaults", block("A", { defaults: undefined as never }), /needs default props/],
    ["an unknown palette group", block("A", { category: "nope" as never }), /unknown palette group "nope"/],
    ["a slot that takes a type nothing registers", block("A", { slots: { items: { allow: ["Missing"] } } }), /takes "Missing" in its "items" slot, which no contribution registers/],
    ["a part nobody holds", block("A", { category: "parts" }), /is a "part" but no block's slot takes it/],
  ])("rejects %s", (_name, definition, message) => {
    expect(() => createPageBlockRegistry([{ id: "m", blocks: [definition] }])).toThrow(message);
  });

  it("rejects a contribution with no id, and a held block that is not in the parts group", () => {
    expect(() => createPageBlockRegistry([{ id: "", blocks: [] }])).toThrow(/needs an id/);
    const parent = block("Parent", { slots: { items: { allow: ["Child"] } } });
    expect(() => createPageBlockRegistry([{ id: "m", blocks: [parent, block("Child")] }])).toThrow(/sits inside another block's list, so its group must be "parts"/);
  });

  it("derives the tables the pages code reads from the definitions: slots, what a slot takes, parts, limits, publish rules", () => {
    const registry = createPageBlockRegistry([
      {
        id: "m",
        blocks: [
          block("Parent", { label: "A parent", slots: { items: { allow: ["Child"] }, extra: {} }, itemLimit: 3, itemRule: { block: "Parent", noun: "child", plural: "children", item: "Child", key: "name" } }),
          block("Child", { category: "parts", order: 5, defaults: { name: "x" } }),
        ],
      },
    ]);
    expect(registry.contributions).toEqual(["m"]);
    expect(registry.slots).toEqual({ Parent: ["items", "extra"] });
    expect(registry.slotAllow).toEqual({ Parent: { items: ["Child"] } });
    expect(registry.itemBlocks).toEqual(["Child"]);
    expect(registry.itemLimits).toEqual({ Parent: 3 });
    expect(registry.itemRules.Parent).toMatchObject({ item: "Child", limit: 3 });
    expect(registry.itemParents).toEqual({ Child: "Parent" });
    expect(registry.labels).toEqual({ Parent: "A parent", Child: "Child" });
    expect(registry.defaults.Child).toEqual({ name: "x" });
    expect(registry.categories.parts.components).toEqual(["Child"]);
    expect(registry.categories.content.components).toEqual(["Parent"]);
    expect(registry.ownerOf("Child")).toBe("m");
    expect(registry.has("Nope")).toBe(false);
    expect(registry.get("Parent")?.label).toBe("A parent");
  });

  it("orders a palette group by `order`, then by registration, so a module's block can sit between two of the pages code's", () => {
    const registry = createPageBlockRegistry([
      { id: "pages", blocks: [block("First", { order: 10 }), block("Third", { order: 30 })] },
      { id: "module", blocks: [block("Second", { order: 20 }), block("AlsoThird", { order: 30 })] },
    ]);
    expect(registry.categories.content.components).toEqual(["First", "Second", "Third", "AlsoThird"]);
  });
});

describe("unregisteredTypes", () => {
  it("lists the stored block types a registry lacks, nested ones included, each once", () => {
    const registry = createPageBlockRegistry([{ id: "m", blocks: [block("Known")] }]);
    const page = {
      content: [
        { type: "Known", props: { id: "a", content: [{ type: "Gone", props: { id: "b" } }] } },
        { type: "Gone", props: { id: "c" } },
        { type: "Other", props: { id: "d", items: [{ type: "Known", props: { id: "e" } }] } },
      ],
      root: { props: {} },
    };
    expect(unregisteredTypes(page, registry)).toEqual(["Gone", "Other"]);
    expect(unregisteredTypes({ content: [], root: {} }, registry)).toEqual([]);
    expect(unregisteredTypes(null, registry)).toEqual([]);
  });
});

describe("the installed registry", () => {
  it("is built from the pages code's blocks and the installed modules' contributions, in that order", () => {
    expect(pageBlocks.contributions).toEqual(["pages", ...installedPageBlocks.map((c) => c.id)]);
    expect(installedPageBlocks).toContain(eventsPageBlocks);
  });

  it("gives every block a label, a component, defaults, a palette group and a position", () => {
    for (const b of pageBlocks.blocks) {
      expect(b.label, b.type).toBeTruthy();
      expect(typeof b.render, b.type).toBe("function");
      expect(b.defaults, b.type).toBeTypeOf("object");
      expect(Object.keys(pageBlocks.categories), b.type).toContain(b.category);
      expect(Number.isFinite(b.order), b.type).toBe(true);
    }
    expect(pageBlocks.blocks.length).toBe(new Set(pageBlocks.blocks.map((b) => b.type)).size);
  });

  it("registers the event blocks from the events contribution and nothing event-shaped from the pages code", () => {
    expect(coreBlocks.blocks.map((b) => b.type)).not.toEqual(expect.arrayContaining(["ComingUp"]));
    for (const type of EVENT_TYPES) {
      expect(pageBlocks.ownerOf(type), type).toBe("events");
      expect(coreBlocks.blocks.some((b) => b.type === type), type).toBe(false);
    }
    expect(eventsPageBlocks.blocks.map((b) => b.type).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("registers the Hedgie Bookshelf block from the bookshelf module, in the Homepage group, with its defaults", () => {
    expect(pageBlocks.ownerOf("HedgieBookshelf")).toBe("bookshelf");
    expect(pageBlocks.contributions).toContain("bookshelf");
    expect(coreBlocks.blocks.some((b) => b.type === "HedgieBookshelf")).toBe(false);
    expect(bookshelfPageBlocks.blocks.map((b) => b.type)).toEqual(["HedgieBookshelf"]);
    expect(pageBlocks.get("HedgieBookshelf")?.category).toBe("homepage");
    expect(pageBlocks.defaults.HedgieBookshelf).toMatchObject({ max: 60, firstShown: 24, genre: "" });
  });

  it("keeps the palette the admins know: the same groups, in the same order", () => {
    const palette = Object.fromEntries(Object.entries(pageBlocks.categories).map(([key, group]) => [key, group.components]));
    expect(palette).toEqual({
      layout: ["Section", "Columns", "Split", "CardGrid", "Divider", "Spacer"],
      ready_made: ["Hero", "Steps", "Stats", "CtaBanner"],
      parts: ["Step", "Stat", "FinisherCard", "TimelineMoment", "WeekDay", "FinishLineCard", "PlanPhase", "RowButton", "ListItem", "Testimonial", "AccordionItem", "FaqQuestion", "GridCard", "LinkItem", "ScheduleRow", "OutcomeNumber"],
      homepage: ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp", "HedgieBookshelf"],
      content: ["Heading", "RichText", "List", "Image", "Video", "Testimonials", "Accordion", "Faq", "Countdown"],
      links: ["Button", "ButtonRow", "LinkList", "OptInForm"],
    });
    expect(pageBlocks.categories.layout.title).toBe("Layout");
    expect(pageBlocks.categories.parts.title).toBe("Parts of a block");
  });

  it("keeps the stored type names and the lists the other code reads (slots, what each slot takes, limits)", () => {
    expect(pageBlocks.slots.Section).toEqual(["content"]);
    expect(pageBlocks.slots.Columns).toEqual(["col1", "col2", "col3"]);
    expect(pageBlocks.slotAllow.SchedulePanel).toEqual({ items: ["ScheduleRow"] });
    expect(pageBlocks.itemLimits.SchedulePanel).toBe(6);
    expect(pageBlocks.itemLimits.OutcomeNumbers).toBe(4);
    expect(pageBlocks.itemRules.SchedulePanel).toMatchObject({ item: "ScheduleRow", liveOk: true, limit: 6 });
    expect(pageBlocks.itemParents.OutcomeNumber).toBe("OutcomeNumbers");
  });
});
