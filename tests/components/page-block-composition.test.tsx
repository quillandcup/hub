// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const proto = (globalThis as unknown as { HTMLElement?: { prototype: Record<string, unknown> } }).HTMLElement?.prototype;
  if (proto) proto.scrollIntoView ??= () => {};
});

import { cleanup, render, screen } from "@testing-library/react";
import { Puck, type Config, type Data } from "@puckeditor/core";
import { createPageBlockRegistry, definePageBlock } from "@/components/landing/block-registry";
import { buildRenderConfig, pageBlocks, renderConfig } from "@/components/landing/config";
import { coreBlocks } from "@/components/landing/core-blocks";
import { buildEditorConfig, editorConfig, editorConfigFor } from "@/components/landing/editor-config";
import LandingRender from "@/components/landing/LandingRender";
import { checkLandingPage } from "@/lib/landing/a11y";
import { installedPageBlockEditors } from "@/modules/editor";
import { eventsPageBlocks } from "@/modules/events/page-blocks";
import { eventsEditorFields } from "@/modules/events/page-blocks/editor";

// Puck starts a 500 ms timer when the editor mounts; clear the ones this file starts so none fires after jsdom is gone (see landing-puck-editor.test.tsx).
const loaderTimers = new Set<unknown>();
const realSetTimeout = globalThis.setTimeout;
beforeAll(() => {
  globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const timer = realSetTimeout(handler as () => void, ms, ...args);
    if (ms === 500) loaderTimers.add(timer);
    return timer;
  }) as typeof setTimeout;
});
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
});
afterEach(() => {
  cleanup();
  for (const timer of loaderTimers) clearTimeout(timer as never);
  loaderTimers.clear();
});

/** What the pages code would be installed with if no module were: the composition the events integration is optional for. */
const withoutEvents = createPageBlockRegistry([coreBlocks]);
const withEvents = createPageBlockRegistry([coreBlocks, eventsPageBlocks]);
const EVENT_TYPES = ["AnnouncementStrip", "SchedulePanel", "ScheduleRow", "ComingUp"];

const typedCard = { kind: "Retreat", title: "Lakeside Retreat", when: "Mar 13 to 15", availability: "", status: "", linkLabel: "", href: "" };
/** A page as it is stored: a heading from the pages code, and the blocks the events integration owns. */
const page = {
  content: [
    { type: "Heading", props: { id: "h", text: "Welcome home", level: "h1", align: "center" } },
    { type: "AnnouncementStrip", props: { id: "a", text: "Our retreat is open", buttonLabel: "Join", href: "/join", tone: "gold", source: "manual" } },
    {
      type: "SchedulePanel",
      props: { id: "s", title: "Writing right now", zoneLabel: "", source: "manual", items: [{ type: "ScheduleRow", props: { id: "r", time: "9:00 am", title: "Morning pages", status: "", state: "open", host: "" } }] },
    },
    { type: "ComingUp", props: { id: "c", heading: "Coming up", style: "cards", source: "manual", items: [typedCard] } },
  ],
  root: { props: {} },
};
const pageJson = JSON.stringify(page);

describe("the renderer and the editor are both built from the registry", () => {
  it("has one component in each config for every registered block, and no other", () => {
    for (const registry of [pageBlocks, withoutEvents, withEvents]) {
      const types = registry.blocks.map((b) => b.type).sort();
      expect(Object.keys(buildRenderConfig(registry).components).sort()).toEqual(types);
      expect(Object.keys(buildEditorConfig(registry, registry === withoutEvents ? [] : [eventsEditorFields]).components).sort()).toEqual(types);
    }
    expect(Object.keys(renderConfig.components).sort()).toEqual(pageBlocks.blocks.map((b) => b.type).sort());
    expect(Object.keys(editorConfig.components).sort()).toEqual(pageBlocks.blocks.map((b) => b.type).sort());
  });

  it("takes a block from any contribution through the same path as the pages code's own", () => {
    const Note = ({ text }: { text: string }) => <p>{text}</p>;
    const extra = createPageBlockRegistry([coreBlocks, { id: "extra", blocks: [definePageBlock({ type: "Note", label: "Note", category: "content", order: 90, defaults: { text: "A note" }, render: Note })] }]);
    const config = buildRenderConfig(extra);
    expect(config.components.Note.label).toBe("Note");
    expect(config.categories.content.components?.at(-1)).toBe("Note");
    const fields = buildEditorConfig(extra, [{ id: "extra", fields: ({ text }) => ({ Note: { text: text("Text") } }) }]);
    expect(fields.components.Note.fields).toEqual({ text: { type: "text", label: "Text" } });
    render(<LandingRender registry={extra} data={{ content: [{ type: "Note", props: { id: "n", text: "Hello from a module" } }], root: { props: {} } }} />);
    expect(screen.getByText("Hello from a module")).toBeInTheDocument();
  });

  it("refuses editor fields for a block nothing registers, and two sets of fields for one block", () => {
    expect(() => buildEditorConfig(withoutEvents, [eventsEditorFields])).toThrow(/for the block "AnnouncementStrip", which no contribution registers/);
    expect(() => buildEditorConfig(withEvents, [eventsEditorFields, { id: "again", fields: ({ text }) => ({ ComingUp: { heading: text("Heading") } }) }])).toThrow(/has editor fields from two contributions/);
  });
});

describe("with the events integration present", () => {
  it("has every event block in the editor, with its fields, and in the public renderer", () => {
    for (const type of EVENT_TYPES) {
      expect(pageBlocks.has(type), type).toBe(true);
      expect(renderConfig.components[type], type).toBeDefined();
      expect(editorConfig.components[type].fields, type).toBeDefined();
      expect(Object.keys(editorConfig.components[type].fields ?? {}).length, type).toBeGreaterThan(0);
    }
    expect(installedPageBlockEditors).toContain(eventsEditorFields);
    expect(Object.values(editorConfig.categories ?? {}).flatMap((c) => c.components ?? [])).toEqual(expect.arrayContaining(["AnnouncementStrip", "SchedulePanel", "ComingUp"]));
  });

  it("renders a stored page with the event blocks in it", () => {
    render(<LandingRender data={page} />);
    expect(screen.getByText("Welcome home")).toBeInTheDocument();
    expect(screen.getByText("Our retreat is open")).toBeInTheDocument();
    expect(screen.getByText("Morning pages")).toBeInTheDocument();
    expect(screen.getByText("Lakeside Retreat")).toBeInTheDocument();
  });

  it("checks the event blocks' links when the page is published", () => {
    const broken = { content: [{ type: "Heading", props: { id: "h", text: "T", level: "h1" } }, { type: "ComingUp", props: { id: "c", style: "cards", source: "manual", items: [{ ...typedCard, linkLabel: "Sign up", href: "" }] } }], root: { props: {} } };
    expect(checkLandingPage(broken).map((i) => i.message)).toContain("Card 1's link (Sign up) has no link.");
  });
});

describe("with the events integration absent", () => {
  it("has no event block in either config or the palette", () => {
    const editor = buildEditorConfig(withoutEvents, []);
    for (const type of EVENT_TYPES) {
      expect(withoutEvents.has(type), type).toBe(false);
      expect(buildRenderConfig(withoutEvents).components[type], type).toBeUndefined();
      expect(editor.components[type], type).toBeUndefined();
    }
    expect(Object.values(editor.categories ?? {}).flatMap((c) => c.components ?? [])).not.toEqual(expect.arrayContaining(["ComingUp"]));
    expect(withoutEvents.itemBlocks).not.toContain("ScheduleRow");
  });

  it("still renders the page: the pages code's blocks show, a stored block nothing owns draws nothing, and the page is not changed", () => {
    render(<LandingRender registry={withoutEvents} data={page} />);
    expect(screen.getByText("Welcome home")).toBeInTheDocument();
    for (const text of ["Our retreat is open", "Morning pages", "Lakeside Retreat", "Writing right now"]) expect(screen.queryByText(text), text).toBeNull();
    expect(JSON.stringify(page)).toBe(pageJson);
  });

  it("gives the editor a stand-in for each stored block it lacks, so opening the page does not crash and keeps the block as stored", () => {
    const base = buildEditorConfig(withoutEvents, []);
    const config = editorConfigFor({ pageType: "landing", site: null, editing: true }, page, base, withoutEvents);
    for (const type of ["AnnouncementStrip", "SchedulePanel", "ScheduleRow", "ComingUp"]) {
      expect(config.components[type].label, type).toBe(`Unavailable: ${type}`);
    }
    // They are not offered in the palette.
    expect(Object.values(config.categories ?? {}).flatMap((c) => c.components ?? [])).not.toContain("ComingUp");

    const { container } = render(<Puck config={config} data={page as unknown as Data} iframe={{ enabled: false }} />);
    expect(screen.getAllByText(/is not available here/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Welcome home");
    expect(JSON.stringify(page)).toBe(pageJson);
  });

  it("adds no stand-in when every block is registered", () => {
    const config = editorConfigFor({ pageType: "landing", site: null, editing: true }, page);
    expect(Object.keys(config.components).sort()).toEqual(Object.keys(editorConfig.components).sort());
    expect((config as Config).components.ComingUp.label).toBe("Coming up");
  });

  it("has nothing to flag in a page whose event blocks are all filled in", () => {
    expect(checkLandingPage(page).filter((i) => i.severity === "error")).toEqual([]);
  });
});
