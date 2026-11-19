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

import { cleanup, render, screen } from "@testing-library/react";
import { Columns, Hero, Heading, Section } from "@/components/landing/blocks";
import { OutcomeNumbers } from "@/components/landing/homepage-blocks";
import { BLOCK_DEFAULTS, SLOTS, renderConfig } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import LandingRender from "@/components/landing/LandingRender";
import { AI_BLOCKS } from "@/lib/landing/ai";
import { checkLandingPage } from "@/lib/landing/a11y";
import { collectAssetIds, normalizeLandingData } from "@/lib/landing/data";
import { migrateLandingData, type LandingMigration } from "@/lib/landing/migrations";
import { sanitizeLandingData } from "@/lib/landing/sanitize";

afterEach(cleanup);

const slot = (label: string) =>
  function SlotContent(props?: { className?: string }) {
    return <p data-testid={label} className={props?.className}>{label}</p>;
  };

const columns = (props: Record<string, unknown>) => ({ type: "Columns", props: { id: "c1", ...BLOCK_DEFAULTS.Columns, col1: [], col2: [], col3: [], ...props } });
const heading = (id: string, text: string, level = "h2") => ({ type: "Heading", props: { id, text, level, align: "left" } });
const page = (...content: unknown[]) => ({ content, root: { props: {} } });

describe("Columns", () => {
  it("is one column on a narrow container and two from the split size, with only named container sizes", () => {
    const { container } = render(<Columns count="2" gap="medium" verticalAlign="top" col1={slot("one")} col2={slot("two")} col3={slot("three")} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("@split:grid-cols-2");
    expect(grid.className).not.toMatch(/(^| )grid-cols-/);
    expect(grid.className).not.toMatch(/(^| )(sm|md|lg|xl):/);
    expect(grid.className).toContain("@split:items-start");
    expect(screen.getByTestId("one")).toBeInTheDocument();
    expect(screen.getByTestId("two")).toBeInTheDocument();
    expect(screen.queryByTestId("three")).toBeNull();
  });

  it("shows a third column for three, centres on request and sets the gap", () => {
    const { container } = render(<Columns count="3" gap="large" verticalAlign="center" col1={slot("one")} col2={slot("two")} col3={slot("three")} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("@split:grid-cols-3");
    expect(grid.className).toContain("@split:items-center");
    expect(grid.className).toContain("gap-12");
    expect(screen.getByTestId("three")).toBeInTheDocument();
  });

  it("falls back to two columns and a medium gap for unknown values, and has no colours of its own", () => {
    const { container } = render(<Columns count={"9" as never} gap={"huge" as never} verticalAlign="top" col1={slot("one")} col2={slot("two")} col3={slot("three")} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("@split:grid-cols-2");
    expect(grid.className).toContain("gap-8");
    expect(grid.className).not.toMatch(/\b(bg|text)-/);
  });

  it("makes every slot a block formatting context, so a heading's margin stays inside it", () => {
    render(<Columns count="2" gap="medium" verticalAlign="top" col1={slot("one")} col2={slot("two")} col3={slot("three")} />);
    expect(screen.getByTestId("one").className).toContain("flow-root");
    cleanup();
    render(<Section background="none" overlay="none" width="wide" padding="medium" align="left" card fadeIn={false} content={slot("inside")} />);
    expect(screen.getByTestId("inside").className).toContain("flow-root");
  });
});

describe("Columns in a page", () => {
  const nested = page({
    type: "Section",
    props: { id: "s1", background: "plum", overlay: "none", width: "wide", padding: "medium", align: "left", card: false, fadeIn: false, content: [columns({ col1: [heading("h1", "Left side", "h1")], col2: [heading("h2", "Right side")] })] },
  });

  it("renders blocks nested in a Columns inside a Section on the public page", () => {
    const { container } = render(<LandingRender data={nested} />);
    expect(screen.getByRole("heading", { level: 1, name: "Left side" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Right side" })).toBeInTheDocument();
    // The heading's margin is held inside the slot in the page itself, not only in the block's own test.
    expect(screen.getByRole("heading", { name: "Left side" }).closest(".flow-root")).not.toBeNull();
    expect(container.querySelector("section .grid")).not.toBeNull();
  });

  it("renders only the columns that are on", () => {
    render(<LandingRender data={page(columns({ count: "2", col1: [heading("a", "A")], col2: [heading("b", "B")], col3: [heading("c", "C")] }))} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("C")).toBeNull();
    cleanup();
    render(<LandingRender data={page(columns({ count: "3", col3: [heading("c", "C")] }))} />);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("has its slots in both configs, and the editor has a label on every non-slot field", () => {
    expect(SLOTS.Columns).toEqual(["col1", "col2", "col3"]);
    for (const slotName of ["col1", "col2", "col3"]) {
      expect(renderConfig.components.Columns.fields?.[slotName]).toEqual({ type: "slot" });
      expect(editorConfig.components.Columns.fields?.[slotName]).toEqual({ type: "slot" });
      expect(renderConfig.components.Columns.defaultProps?.[slotName]).toEqual([]);
    }
    for (const [key, field] of Object.entries(editorConfig.components.Columns.fields ?? {})) {
      if (field.type !== "slot") expect((field as { label?: string }).label, key).toBeTruthy();
    }
    expect(renderConfig.categories.layout.components).toContain("Columns");
  });

  it("is not offered to the AI builder", () => {
    expect(AI_BLOCKS).not.toContain("Columns");
  });

  it("cleans rich text and links in every column, however deep", () => {
    const clean = sanitizeLandingData(
      page({
        type: "Section",
        props: { id: "s", content: [columns({ col2: [{ type: "RichText", props: { id: "r", html: "<p>ok</p><script>x</script>" } }], col3: [{ type: "Button", props: { id: "b", label: "Go", href: "javascript:x" } }] })] },
      }),
    );
    const cols = (clean.content[0] as { props: { content: { props: Record<string, { props: Record<string, string> }[]> }[] } }).props.content[0].props;
    expect(cols.col2[0].props.html).toBe("<p>ok</p>");
    expect(cols.col3[0].props.href).toBe("");
  });

  it("collects the pictures in every column, once", () => {
    const data = page(columns({ col1: [{ type: "Image", props: { id: "i1", imageAssetId: "media_a", alt: "x" } }], col3: [{ type: "Image", props: { id: "i2", imageAssetId: "media_b", alt: "y" } }, { type: "Image", props: { id: "i3", imageAssetId: "media_a", alt: "z" } }] }));
    expect(collectAssetIds(data)).toEqual(["media_a", "media_b"]);
  });

  it("migrates blocks in a Columns inside a Section, and stays stable run twice", () => {
    const steps: LandingMigration[] = [{ version: 1, blocks: { Heading: ({ text, ...rest }) => ("title" in rest ? { text, ...rest } : { title: text, ...rest }) } }];
    const once = migrateLandingData(nested as never, steps) as never as { content: { props: { content: { props: Record<string, { props: Record<string, string> }[]> }[] } }[] };
    const cols = once.content[0].props.content[0].props;
    expect(cols.col1[0].props).toMatchObject({ title: "Left side" });
    expect(cols.col2[0].props).toMatchObject({ title: "Right side" });
    expect(migrateLandingData(once as never, steps)).toEqual(once);
    expect(normalizeLandingData(nested).content).toHaveLength(1);
  });

  it("checks the blocks in the columns that are showing, in a Section too", () => {
    const withImage = (alt: string) => ({ type: "Image", props: { id: "i", imageAssetId: "media_a", alt, decorative: false } });
    const issues = checkLandingPage(
      page({ type: "Section", props: { id: "s", content: [columns({ col1: [heading("t", "Title", "h1")], col2: [withImage("")] })] } }),
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.block)).toEqual(["Image"]);
    expect(checkLandingPage(page(columns({ col1: [heading("t", "Title", "h1")], col2: [withImage("A description")] }))).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("ignores what is left in a third column that is switched off, and checks it when it is on", () => {
    const bad = { type: "Button", props: { id: "b", label: "Go", href: "" } };
    const base = [heading("t", "Title", "h1")];
    expect(checkLandingPage(page(columns({ count: "2", col1: base, col3: [bad] }))).filter((i) => i.severity === "error")).toEqual([]);
    expect(checkLandingPage(page(columns({ count: "3", col1: base, col3: [bad] }))).filter((i) => i.severity === "error")).toHaveLength(1);
  });
});

describe("Space above and below", () => {
  const heroProps = { ...BLOCK_DEFAULTS.Hero, primary: { label: "Join", href: "/join" }, secondary: { label: "", href: "" } } as unknown as Parameters<typeof Hero>[0];
  const hero = (padding?: string) => render(<Hero {...heroProps} padding={padding as never} />).container.querySelector("section")!.className;

  it("keeps a Hero saved without the option exactly as it was (large)", () => {
    const { padding: _unused, ...saved } = heroProps;
    void _unused;
    const before = render(<Hero {...(saved as Parameters<typeof Hero>[0])} />).container.querySelector("section")!.className;
    expect(before).toContain("py-16 @split:py-24");
    expect(BLOCK_DEFAULTS.Hero.padding).toBe("large");
    cleanup();
    expect(hero("large")).toBe(before);
  });

  it("gives a Hero smaller spaces, and the original for a value it does not know", () => {
    expect(hero("medium")).toContain("py-10 @split:py-14");
    cleanup();
    expect(hero("small")).toContain("py-6 @split:py-8");
    cleanup();
    expect(hero("none")).toContain("py-0");
    cleanup();
    expect(hero("enormous")).toContain("py-16 @split:py-24");
  });

  it("keeps Outcome numbers saved without the option exactly as it was (py-10), and offers the same four choices", () => {
    const items = [{ value: "50+", label: "books", note: "" }, { value: "100s", label: "Finishers", note: "" }];
    const band = (padding?: string) => render(<OutcomeNumbers items={items} padding={padding as never} />).container.firstElementChild!.className;
    const saved = band();
    expect(saved).toContain("py-10");
    expect(BLOCK_DEFAULTS.OutcomeNumbers.padding).toBe("medium");
    cleanup();
    expect(band("medium")).toBe(saved);
    cleanup();
    expect(band("small")).toContain("py-6");
    cleanup();
    expect(band("none")).toContain("py-0");
    cleanup();
    expect(band("large")).toContain("py-16");
    for (const name of ["Hero", "OutcomeNumbers"]) {
      const field = editorConfig.components[name].fields?.padding as { label: string; options: { value: string }[] };
      expect(field.label).toBe("Space above and below");
      expect(field.options.map((o) => o.value)).toEqual(["none", "small", "medium", "large"]);
    }
  });

  it("is not changed by a Heading's own margin being held in a slot", () => {
    const { container } = render(<Heading text="Hi" level="h2" align="left" />);
    expect(container.firstElementChild!.className).toContain("my-3");
  });
});
