// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import type { ComponentType } from "react";
import { cleanup, render } from "@testing-library/react";
import { BLOCK_DEFAULTS, BLOCK_LABELS, ITEM_BLOCKS, SLOT_ALLOW, SLOTS, renderConfig } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import LandingRender from "@/components/landing/LandingRender";
import { ITEM_LIMITS } from "@/components/landing/item-limits";
import { checkLandingPage } from "@/lib/landing/a11y";
import { cleanGeneratedBlocks, pageForModel, systemPrompt } from "@/lib/landing/ai";
import { collectAssetIds, normalizeLandingData, mapAssetIds } from "@/lib/landing/data";
import { pruneToKnownBlocks } from "@/lib/landing/json-transfer";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { sampleLandingPage } from "../helpers/landing-sample-page";
import { itemsSlot } from "./landing-items-slot";

afterEach(cleanup);

/**
 * Blocks that hold a list of items as a slot of child blocks (docs/product/LANDING_PAGES.md, "Blocks with items"): the data shape, the
 * public render, the publish check, the AI builder and the JSON import all follow the one table (`SLOT_ALLOW`).
 */

type Node = { type: string; props: Record<string, unknown> };
/** A block's render function as Puck calls it: with its props and the `puck` object. */
const renderOf = (name: keyof typeof BLOCK_DEFAULTS) => renderConfig.components[name].render as unknown as ComponentType<Record<string, unknown>>;
const PARENTS = Object.keys(SLOT_ALLOW) as (keyof typeof BLOCK_DEFAULTS)[];
const itemType = (parent: keyof typeof BLOCK_DEFAULTS) => SLOT_ALLOW[parent]!.items[0];
let n = 0;
const kid = (type: string, props: Record<string, unknown> = {}): Node => ({ type, props: { id: `k${n++}`, ...(BLOCK_DEFAULTS[type as keyof typeof BLOCK_DEFAULTS] as object), ...props } });
const page = (...content: Node[]) => ({ content: [{ type: "Heading", props: { id: "h1", text: "Home", level: "h1", align: "center" } }, { type: "Heading", props: { id: "h2", text: "Section", level: "h2", align: "center" } }, ...content], root: {} });
const messages = (data: unknown) => checkLandingPage(data).map((i) => `${i.severity} ${i.block}: ${i.message}`);

describe("the table of blocks that hold items", () => {
  it.each(PARENTS)("%s: its slot, its item type, its defaults and its palette entry agree", (parent) => {
    const type = itemType(parent);
    expect(SLOTS[parent]).toEqual(["items"]);
    expect(ITEM_BLOCKS).toContain(type);
    // A new block starts with a few items of the right type, and the item has defaults and a name of its own.
    const starting = (BLOCK_DEFAULTS[parent] as unknown as { items: Node[] }).items;
    expect(starting.length).toBeGreaterThanOrEqual(2);
    if (parent in ITEM_LIMITS) expect(starting.length).toBeLessThanOrEqual(ITEM_LIMITS[parent as keyof typeof ITEM_LIMITS]);
    expect(starting.every((k) => k.type === type)).toBe(true);
    expect(BLOCK_DEFAULTS[type]).toBeDefined();
    expect(BLOCK_LABELS[type]).toBeTruthy();
    expect(renderConfig.components[parent].defaultProps?.items).toHaveLength(starting.length);
    expect(renderConfig.components[type].defaultProps).toEqual(BLOCK_DEFAULTS[type]);
    // The editor limits the slot to that type, and the item has fields, every one labelled.
    expect(editorConfig.components[parent].fields?.items).toMatchObject({ type: "slot", allow: [type] });
    const fields = editorConfig.components[type].fields ?? {};
    expect(Object.keys(fields).length).toBeGreaterThan(0);
    for (const [key, field] of Object.entries(fields)) expect((field as { label?: string }).label, `${type}.${key}`).toBeTruthy();
    // The items are no longer an array field in the panel: they are the blocks in the slot.
    expect(editorConfig.components[parent].fields?.items.type).toBe("slot");
  });

  it("has a layout limit only for the blocks whose layout has one, and puts the items in the palette under their own group", () => {
    // Steps, Stats... are laid out for a few; a List, FAQ, Testimonials, Card grid or Link list takes any number.
    for (const parent of Object.keys(ITEM_LIMITS)) expect(PARENTS).toContain(parent);
    for (const parent of ["List", "Testimonials", "Accordion", "Faq", "CardGrid", "LinkList"]) expect(ITEM_LIMITS).not.toHaveProperty(parent);
    expect(renderConfig.categories.parts.components).toEqual(ITEM_BLOCKS);
    for (const [group, { components }] of Object.entries(renderConfig.categories)) {
      if (group !== "parts") for (const type of ITEM_BLOCKS) expect(components as string[], group).not.toContain(type);
    }
  });

  it("renders every item type with the editor's drag handle on its own root, and a parent not hidden while editing", () => {
    for (const parent of PARENTS) {
      const type = itemType(parent);
      const dragRef = vi.fn();
      const Item = renderOf(type);
      const { container, unmount } = render(<Item {...(BLOCK_DEFAULTS[type] as object)} id="x" puck={{ dragRef, isEditing: true }} />);
      expect(dragRef, type).toHaveBeenCalledWith(container.firstElementChild);
      unmount();
      const Parent = renderOf(parent);
      const empty = () => <></>;
      const editing = render(<Parent {...(BLOCK_DEFAULTS[parent] as object)} id="p" items={empty} puck={{ isEditing: true }} />);
      expect(editing.container.innerHTML, parent).not.toContain("empty:hidden");
      editing.unmount();
      const live = render(<Parent {...(BLOCK_DEFAULTS[parent] as object)} id="p" items={empty} puck={{ isEditing: false }} />);
      expect(live.container.innerHTML, parent).not.toBe("");
      live.unmount();
    }
  });
});

describe("the public page", () => {
  const week = (labels: string[]) => page({ type: "WeekStrip", props: { id: "w", subtitle: "", items: labels.map((label) => kid("WeekDay", { label, text: `${label} thing` })) } });
  const order = (container: HTMLElement) => [...container.querySelectorAll("ol > li")].map((li) => li.querySelector("p")?.textContent);

  it("draws the items in the order they are stored, so moving one on the canvas moves it on the page", () => {
    expect(order(render(<LandingRender data={week(["Mon", "Tue", "Wed"])} />).container)).toEqual(["Mon", "Tue", "Wed"]);
    cleanup();
    expect(order(render(<LandingRender data={week(["Tue", "Mon", "Wed"])} />).container)).toEqual(["Tue", "Mon", "Wed"]);
  });

  it("makes a block with no items draw no list, and hides the ones past the layout's limit", () => {
    const { container } = render(<LandingRender data={week([])} />);
    expect(container.querySelector("ol")!.className).toContain("empty:hidden");
    cleanup();
    const many = render(<LandingRender data={week(Array.from({ length: 9 }, (_, i) => `D${i}`))} />);
    expect(many.container.querySelector("ol")!.className).toContain(`[&>:nth-child(n+${ITEM_LIMITS.WeekStrip + 1})]:hidden`);
  });

  it("cleans each item's link and keeps the item's picture in the page's asset list", () => {
    const data = page({ type: "FinisherCards", props: { id: "f", more: { label: "", href: "" }, items: [kid("FinisherCard", { name: "Ada Example", imageAssetId: "media_AAAAAAAAAAA1", alt: "Ada", href: "javascript:x", linkLabel: "Read" })] } });
    const clean = sanitizeLandingData(data);
    const card = ((clean.content[2] as Node).props.items as Node[])[0];
    expect(card.props.href).toBe("");
    expect(collectAssetIds(data)).toEqual(["media_AAAAAAAAAAA1"]);
    const swapped = mapAssetIds(normalizeLandingData(data), (id) => id.replace("AAAA", "BBBB"));
    expect(collectAssetIds(swapped)).toEqual(["media_BBBBAAAAAAA1"]);
  });
});

describe("the publish check", () => {
  it("warns about a block with no items, and about items past what the layout shows", () => {
    expect(messages(page({ type: "WeekStrip", props: { id: "w", items: [] } }))).toEqual(['warning Week strip: Week strip has no days, so it shows nothing. Drag one in from "Parts of a block".']);
    expect(messages(page({ type: "WeekStrip", props: { id: "w" } }))).toHaveLength(1);
    // A day with no label is not shown, so it does not count.
    expect(messages(page({ type: "WeekStrip", props: { id: "w", items: [kid("WeekDay", { label: "" })] } }))).toHaveLength(1);
    const eight = Array.from({ length: 8 }, (_, i) => kid("WeekDay", { label: `D${i}` }));
    expect(messages(page({ type: "WeekStrip", props: { id: "w", items: eight } }))).toEqual(["warning Week strip: Week strip shows 7 days at most; the 1 after that are hidden."]);
  });

  it("warns about an item standing on its own, and checks it like one inside its block", () => {
    expect(messages(page(kid("Step", { title: "Lost" })))).toEqual(["warning Steps: A step is outside a Steps block. Drag it into one, or delete it."].map((m) => expect.stringContaining(m.split(": ")[1])));
    const stray = page(kid("FinisherCard", { name: "Ada", imageAssetId: "media_AAAAAAAAAAA1", alt: "", linkLabel: "" }));
    expect(messages(stray).filter((m) => m.startsWith("error"))).toEqual(["error Finisher cards: A Finisher has a photo with no description."]);
  });

  it("numbers an item by its place in the list, and checks every item's link", () => {
    const cards = ["Ada", "Bea"].map((name, i) => kid("FinisherCard", { name, linkLabel: "Read", href: i === 1 ? "" : "/x" }));
    expect(messages(page({ type: "FinisherCards", props: { id: "f", more: { label: "", href: "" }, items: cards } }))).toEqual(["error Finisher cards: Finisher 2's link (Read) has no link."]);
    const lines = [kid("FinishLineCard", { title: "A", buttonLabel: "See", href: "" })];
    expect(messages(page({ type: "FinishLineCards", props: { id: "l", items: lines } }))).toEqual(["error Finish-line cards: The button \"See\" has no link."]);
  });

  it("counts an item's title as a heading a level under the section's", () => {
    const jump = { content: [{ type: "Heading", props: { id: "a", text: "Home", level: "h1" } }, { type: "Timeline", props: { id: "t", heading: "", items: [kid("TimelineMoment", { title: "Morning" })] } }], root: {} };
    expect(messages(jump).join()).toContain("skips a level");
  });
});

describe("a realistic page", () => {
  it("hold only items of the type their block takes, each with its own id, and pass the publish check's errors only where a link is still to be set", () => {
    const content = sampleLandingPage().content as Node[];
    const ids: string[] = [];
    const visit = (nodes: Node[], parent?: string) => {
      for (const node of nodes) {
        ids.push(node.props.id as string);
        if (ITEM_BLOCKS.includes(node.type as never)) expect(SLOT_ALLOW[parent as keyof typeof SLOT_ALLOW]?.items, `${node.type} in ${parent}`).toContain(node.type);
        for (const value of Object.values(node.props)) if (Array.isArray(value) && value.every((v) => v && typeof v === "object" && "type" in v)) visit(value as Node[], node.type);
      }
    };
    visit(content);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pruneToKnownBlocks(normalizeLandingData(sampleLandingPage()))).toMatchObject({ leftOut: [], droppedProps: 0 });
    // Every block with items has some in the sample page, so none is blank.
    const text = JSON.stringify(content);
    // The homepage has no List, Pricing, FAQ, Testimonials, Card grid, Link list, Steps or Stats; every other block with items is in it.
    for (const parent of PARENTS.filter((p) => !["Steps", "Stats", "List", "Testimonials", "Accordion", "Faq", "CardGrid", "LinkList", "Pricing", "SocialIcons"].includes(p))) expect(text).toContain(`"type":"${itemType(parent)}"`);
  });
});

describe("JSON import", () => {
  it("keeps the items of a block and their picture prop, and drops a block that is not the type the list takes", () => {
    const data = {
      content: [{ type: "FinisherCards", props: { id: "f", more: { label: "", href: "" }, items: [kid("FinisherCard", { name: "Ada", imageAssetId: "media_AAAAAAAAAAA1" }), kid("Heading", { text: "Not a card" }), { type: "Nope", props: {} }] } }],
      root: {},
    };
    const { data: pruned, leftOut, droppedProps } = pruneToKnownBlocks(normalizeLandingData(data));
    const items = (pruned.content[0] as Node).props.items as Node[];
    expect(items.map((i) => i.type)).toEqual(["FinisherCard"]);
    expect(items[0].props.imageAssetId).toBe("media_AAAAAAAAAAA1");
    expect(leftOut).toEqual([{ type: "Heading", count: 1 }, { type: "Nope", count: 1 }]);
    expect(droppedProps).toBe(0);
  });
});

describe("the AI builder", () => {
  it("offers Steps and Stats with their items as child blocks, and cleans what it gets back", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain('a list of Step blocks, each {"type": "Step"');
    expect(prompt).toContain('a list of Stat blocks, each {"type": "Stat"');
    const data = cleanGeneratedBlocks({
      blocks: [
        { type: "Steps", props: { heading: "How", items: [{ type: "Step", props: { title: "One", text: "a", junk: 1 } }, { title: "Two", text: "b" }, { type: "Heading", props: { text: "wrong kind" } }, { type: "Step", props: { title: "Three", text: "c", imageAssetId: "media_x" } }] } },
        { type: "Stats", props: { items: [{ type: "Stat", props: { value: "3", label: "a week" } }] } },
        { type: "WeekStrip", props: {} },
      ],
    })!;
    const [steps, stats] = data.content as Node[];
    expect((steps.props.items as Node[]).map((i) => [i.type, i.props.title])).toEqual([["Step", "One"], ["Step", "Two"], ["Step", "Three"]]);
    expect((steps.props.items as Node[])[0].props).toEqual({ id: expect.any(String), title: "One", text: "a" });
    expect((stats.props.items as Node[]).map((i) => i.type)).toEqual(["Stat"]);
    // A block with items it was not offered is dropped, as any other.
    expect(data.content).toHaveLength(2);
  });

  it("shows the model the items of a block, and keeps an item's id and what it was not sent when the page is revised", () => {
    const current = [{ type: "Steps", props: { id: "st", heading: "How", items: [{ type: "Step", props: { id: "s1", title: "One", text: "a" } }, { type: "Step", props: { id: "s2", title: "Two", text: "b" } }] } }];
    const view = pageForModel(current) as { props: { items: { id: string; type: string; props: { title: string } }[] } }[];
    expect(view[0].props.items.map((i) => [i.id, i.type, i.props.title])).toEqual([["s1", "Step", "One"], ["s2", "Step", "Two"]]);
    // Swapped by the model: the ids say which is which, so each keeps its own.
    const revised = cleanGeneratedBlocks({ blocks: [{ id: "st", type: "Steps", props: { items: [{ id: "s2", type: "Step", props: { title: "Two" } }, { id: "s1", type: "Step", props: { title: "One" } }] } }] }, current)!;
    const items = (revised.content[0] as Node).props.items as Node[];
    expect(items.map((i) => [i.props.id, i.props.title, i.props.text])).toEqual([["s2", "Two", "b"], ["s1", "One", "a"]]);
    // Not sending the items at all leaves them as they are.
    const kept = cleanGeneratedBlocks({ blocks: [{ id: "st", type: "Steps", props: { heading: "Changed" } }] }, current)!;
    expect(((kept.content[0] as Node).props.items as Node[]).map((i) => i.props.id)).toEqual(["s1", "s2"]);
    expect((kept.content[0] as Node).props.heading).toBe("Changed");
  });
});

/**
 * The second batch: Buttons, List, Testimonials, FAQ, Card grid, Link list, Schedule panel and Outcome numbers, whose items
 * used to be array fields. The shared behaviour is in the tables above; these are the parts that differ per block.
 */
describe("the lists that used to be array fields", () => {
  const text = (container: HTMLElement) => container.textContent ?? "";

  it("draw their items in the order they are stored, through the public page", () => {
    const cases: [string, Record<string, unknown>, Node[], string[]][] = [
      ["List", { align: "left" }, ["One", "Two"].map((t) => kid("ListItem", { text: t })), ["One", "Two"]],
      ["Testimonials", {}, ["Quote A", "Quote B"].map((q) => kid("Testimonial", { quote: q })), ["Quote A", "Quote B"]],
      ["Pricing", {}, ["Plan A", "Plan B"].map((n) => kid("PricingPlan", { name: n })), ["Plan A", "Plan B"]],
      ["Accordion", {}, ["Title one", "Title two"].map((t) => kid("AccordionItem", { title: t })), ["Title one", "Title two"]],
      ["Faq", {}, ["Q one", "Q two"].map((q) => kid("FaqQuestion", { question: q })), ["Q one", "Q two"]],
      ["CardGrid", { columns: "3" }, ["Card A", "Card B"].map((t) => kid("GridCard", { title: t })), ["Card A", "Card B"]],
      ["LinkList", {}, ["Link A", "Link B"].map((l) => kid("LinkItem", { label: l, href: "/x" })), ["Link A", "Link B"]],
      ["ButtonRow", { align: "left", gap: "medium" }, ["Go A", "Go B"].map((l) => kid("RowButton", { label: l, href: "/x" })), ["Go A", "Go B"]],
      ["SchedulePanel", { title: "Today", source: "manual" }, ["Sess A", "Sess B"].map((t) => kid("ScheduleRow", { title: t })), ["Sess A", "Sess B"]],
      ["OutcomeNumbers", {}, ["10", "20"].map((v) => kid("OutcomeNumber", { value: v })), ["10", "20"]],
    ];
    for (const [parent, props, items, expected] of cases) {
      for (const reversed of [false, true]) {
        const stored = reversed ? [...items].reverse() : items;
        const wanted = reversed ? [...expected].reverse() : expected;
        const { container, unmount } = render(<LandingRender data={page({ type: parent, props: { id: "p", ...props, items: stored } })} />);
        const at = (word: string) => text(container).indexOf(word);
        expect(at(wanted[0]), `${parent} ${wanted}`).toBeGreaterThan(-1);
        expect(at(wanted[0]), `${parent} ${wanted}`).toBeLessThan(at(wanted[1]));
        unmount();
      }
    }
  });

  it("hide an empty list on the public page, but not while editing", () => {
    for (const parent of ["List", "Testimonials", "Accordion", "Faq", "CardGrid", "LinkList", "ButtonRow", "Pricing"] as const) {
      const Parent = renderOf(parent);
      const none = itemsSlot(renderOf(itemType(parent)) as ComponentType<object>, []);
      const live = render(<Parent {...(BLOCK_DEFAULTS[parent] as object)} id="p" items={none} puck={{ isEditing: false }} />);
      expect(live.container.innerHTML, parent).toContain("empty:hidden");
      live.unmount();
      const editing = render(<Parent {...(BLOCK_DEFAULTS[parent] as object)} id="p" items={none} puck={{ isEditing: true }} />);
      expect(editing.container.innerHTML, parent).not.toContain("empty:hidden");
      editing.unmount();
    }
  });

  it("keep a Card grid's picture on the card, in the page's asset list, and clean its link", () => {
    const data = page({ type: "CardGrid", props: { id: "g", columns: "2", items: [kid("GridCard", { title: "Book", imageAssetId: "media_AAAAAAAAAAA1", alt: "Cover", buttonLabel: "Buy", href: "javascript:x" })] } });
    expect(collectAssetIds(data)).toEqual(["media_AAAAAAAAAAA1"]);
    const card = ((sanitizeLandingData(data).content[2] as Node).props.items as Node[])[0].props;
    expect(card.href).toBe("");
    const swapped = mapAssetIds(normalizeLandingData(data), (id) => id.replace("AAAA", "BBBB"));
    expect(collectAssetIds(swapped)).toEqual(["media_BBBBAAAAAAA1"]);
  });
});

describe("the publish check for the second batch", () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ["ButtonRow", "RowButton", { label: "Join", href: "/x" }],
    ["List", "ListItem", { text: "A point" }],
    ["Testimonials", "Testimonial", { quote: "Lovely" }],
    ["Accordion", "AccordionItem", { title: "Why?" }],
    ["Faq", "FaqQuestion", { question: "Why?" }],
    ["CardGrid", "GridCard", { title: "A card" }],
    ["LinkList", "LinkItem", { label: "Home", href: "/" }],
    ["SchedulePanel", "ScheduleRow", { title: "Morning pages" }],
    ["OutcomeNumbers", "OutcomeNumber", { value: "50+" }],
  ];

  it.each(cases)("%s: warns when it has no items, passes with one, and warns about an item outside it", (parent, item, props) => {
    const empty = messages(page({ type: parent, props: { id: "p", source: "manual", items: [] } }));
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatch(/^warning .*: .* has no .*, so it shows nothing\. Drag one in from "Parts of a block"\.$/);
    expect(messages(page({ type: parent, props: { id: "p", source: "manual", items: [kid(item, props)] } })).filter((m) => /has no .*, so it shows nothing/.test(m))).toEqual([]);
    expect(messages(page(kid(item, props))).join()).toContain("is outside a");
  });

  it("warns about items past the limit for the blocks that have one, and never for the ones that do not", () => {
    const four = Array.from({ length: 4 }, (_, i) => kid("RowButton", { label: `Go ${i}`, href: "/x" }));
    expect(messages(page({ type: "ButtonRow", props: { id: "b", items: four } }))).toEqual(["warning Buttons: Buttons shows 3 buttons at most; the 1 after that are hidden."]);
    const seven = Array.from({ length: 7 }, (_, i) => kid("ScheduleRow", { title: `S${i}` }));
    expect(messages(page({ type: "SchedulePanel", props: { id: "s", source: "manual", items: seven } }))).toEqual(["warning Schedule panel: Schedule panel shows 6 sessions at most; the 1 after that are hidden."]);
    const five = Array.from({ length: 5 }, (_, i) => kid("OutcomeNumber", { value: `${i}` }));
    expect(messages(page({ type: "OutcomeNumbers", props: { id: "o", items: five } }))).toEqual(["warning Outcome numbers: Outcome numbers shows 4 figures at most; the 1 after that are hidden."]);
    const many = Array.from({ length: 30 }, (_, i) => kid("ListItem", { text: `P${i}` }));
    expect(messages(page({ type: "List", props: { id: "l", items: many } }))).toEqual([]);
  });

  it("does not warn about a live schedule panel with no typed sessions, and counts a live figure with no typed value", () => {
    expect(messages(page({ type: "SchedulePanel", props: { id: "s", source: "live", items: [] } }))).toEqual([]);
    expect(messages(page({ type: "OutcomeNumbers", props: { id: "o", items: [kid("OutcomeNumber", { source: "live", stat: "hours_30d", value: "" })] } }))).toEqual([]);
    expect(messages(page({ type: "OutcomeNumbers", props: { id: "o", items: [kid("OutcomeNumber", { source: "manual", value: "" })] } }))).toHaveLength(1);
  });

  it("numbers a card by its place and checks its picture, button and link text; checks each Link list item", () => {
    const cards = [kid("GridCard", { title: "Fine" }), kid("GridCard", { title: "Pic", imageAssetId: "media_AAAAAAAAAAA1", alt: "" }), kid("GridCard", { title: "Btn", buttonLabel: "Buy", href: "" }), kid("GridCard", { title: "Vague", buttonLabel: "here", href: "/x" })];
    expect(messages(page({ type: "CardGrid", props: { id: "g", columns: "3", items: cards } }))).toEqual(["error Card grid: Card 2 has a picture with no description.", "error Card grid: Card 3's button has no link.", 'warning Card grid: Card 4\'s button says "here": say where it goes.']);
    expect(messages(page({ type: "LinkList", props: { id: "l", items: [kid("LinkItem", { label: "Shop", href: "" }), kid("LinkItem", { label: "here", href: "/x" })] } }))).toEqual(['error Link list: The link "Shop" has no address.', 'warning Link list: A link that says "here" doesn\'t say where it goes.']);
  });
});

describe("a realistic page and JSON import for the second batch", () => {
  it("keep the items of these blocks, and drop another kind of block from their lists", () => {
    const data = {
      content: [
        { type: "List", props: { id: "l", align: "left", items: [kid("ListItem", { text: "Keep" }), kid("Step", { title: "Wrong" }), { type: "Nope", props: {} }] } },
        { type: "SchedulePanel", props: { id: "s", items: [kid("ScheduleRow", { title: "Morning" }), kid("OutcomeNumber", { value: "1" })] } },
        { type: "CardGrid", props: { id: "g", columns: "2", items: [kid("GridCard", { title: "Card", imageAssetId: "media_AAAAAAAAAAA1" })] } },
      ],
      root: {},
    };
    const { data: pruned, leftOut } = pruneToKnownBlocks(normalizeLandingData(data));
    const types = (i: number) => ((pruned.content[i] as Node).props.items as Node[]).map((n) => n.type);
    expect(types(0)).toEqual(["ListItem"]);
    expect(types(1)).toEqual(["ScheduleRow"]);
    expect(types(2)).toEqual(["GridCard"]);
    expect(((pruned.content[2] as Node).props.items as Node[])[0].props.imageAssetId).toBe("media_AAAAAAAAAAA1");
    expect(leftOut).toEqual(expect.arrayContaining([{ type: "Step", count: 1 }, { type: "Nope", count: 1 }, { type: "OutcomeNumber", count: 1 }]));
  });

  it("have the homepage's Buttons, Schedule panel and Outcome numbers as blocks in their slots, with ids", () => {
    const text = JSON.stringify(sampleLandingPage().content);
    for (const type of ["RowButton", "ScheduleRow", "OutcomeNumber"]) expect(text).toContain(`"type":"${type}"`);
    expect(text).not.toContain('"rows":');
  });
});
