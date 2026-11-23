// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pricing, PricingPlan } from "@/components/landing/blocks";
import { ITEM_LIMITS } from "@/components/landing/item-limits";
import { checkLandingPage } from "@/lib/landing/a11y";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";
import { pruneToKnownBlocks } from "@/lib/landing/json-transfer";
import { normalizeLandingData } from "@/lib/landing/data";
import { itemsSlot } from "./landing-items-slot";

const plan = (over: Record<string, unknown> = {}) => ({ name: "Starter", price: "$12", period: "per month", description: "For a first try.", features: "One thing\n\nAnother thing", badge: "", featured: false, buttonLabel: "Choose Starter", href: "/join", ...over });

describe("the Pricing block", () => {
  it("draws a plan with its price and period in one line, its description, its list and a button with the link", () => {
    const { container } = render(<Pricing items={itemsSlot(PricingPlan, [plan()])} />);
    expect(screen.getByRole("heading", { level: 3, name: "Starter" })).toBeInTheDocument();
    const price = screen.getByText("$12").closest("p")!;
    expect(price.textContent).toBe("$12 per month");
    expect(screen.getByText("For a first try.")).toBeInTheDocument();
    expect([...container.querySelectorAll("li li")].map((l) => l.textContent)).toEqual(["✓One thing", "✓Another thing"]);
    expect(screen.getByRole("link", { name: "Choose Starter" })).toHaveAttribute("href", "/join");
  });

  it("shows the price exactly as typed, with no parsing or maths", () => {
    render(<Pricing items={itemsSlot(PricingPlan, [plan({ price: "$1,997.00 +tax", period: "" })])} />);
    expect(screen.getByText("$1,997.00 +tax")).toBeInTheDocument();
  });

  it("says a featured plan is featured in words and shape, not colour alone, and shows the badge text", () => {
    const { container } = render(<Pricing items={itemsSlot(PricingPlan, [plan({ name: "Plain" }), plan({ name: "Best", featured: true, badge: "Most popular" })])} />);
    const [plain, best] = [...container.querySelectorAll("ul > li")].filter((li) => li.querySelector("h3"));
    expect(plain.textContent).not.toContain("Featured plan");
    expect(plain.className).not.toContain("border-4");
    expect(best.className).toContain("border-4");
    expect(best.textContent).toContain("Featured plan. Most popular");
    expect(best.querySelector(".sr-only")).toHaveTextContent("Featured plan.");
  });

  it("labels a featured plan for screen readers even with no badge text", () => {
    const { container } = render(<Pricing items={itemsSlot(PricingPlan, [plan({ featured: true, badge: "" })])} />);
    expect(container.querySelector(".sr-only")).toHaveTextContent("Featured plan.");
  });

  it("uses named container sizes and theme colours only", () => {
    const { container } = render(<Pricing items={itemsSlot(PricingPlan, [plan({ featured: true })])} />);
    const html = container.innerHTML;
    expect(html).toContain("@pair:grid-cols-");
    expect(html).not.toMatch(/(?:^|[\s"])(?:sm|md|lg|xl):|@\[|#[0-9a-f]{3,6}\b/i);
    expect(html).toContain("bg-tile");
  });

  it("is laid out for three plans at most (the fourth is hidden on the public page, not while editing)", () => {
    expect(ITEM_LIMITS.Pricing).toBe(3);
    const view = render(<Pricing items={itemsSlot(PricingPlan, [plan()])} />);
    expect(view.container.querySelector("ul")!.className).toContain("[&>:nth-child(n+4)]:hidden");
    view.unmount();
    expect(render(<Pricing editing items={itemsSlot(PricingPlan, [plan()])} />).container.querySelector("ul")!.className).not.toContain("nth-child");
  });

  it("goes through safeHref: an unsafe link draws no button for a visitor, and a disabled one while editing", () => {
    const view = render(<PricingPlan {...plan({ href: "javascript:alert(1)" })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(view.container.querySelector("[aria-disabled]")).toBeNull();
    view.unmount();
    const editing = render(<PricingPlan {...plan({ href: "javascript:alert(1)" })} editing />);
    expect(editing.container.querySelector('[aria-disabled="true"]')).toHaveTextContent("Choose Starter");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("draws nothing for a plan with no name or price on the public page, but keeps it visible while editing", () => {
    expect(render(<PricingPlan {...plan({ name: "", price: "" })} />).container.innerHTML).toBe("");
    expect(render(<PricingPlan {...plan({ name: "", price: "" })} editing />).container.querySelector("li")).not.toBeNull();
  });

  it("draws a plan with only a name: no price line, no list, no button", () => {
    const { container } = render(<PricingPlan name="Free" price="" period="" description="" features="" badge="" featured={false} buttonLabel="" href="" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelectorAll("li li")).toHaveLength(0);
  });
});

describe("the publish check for Pricing", () => {
  const title = { type: "Heading", props: { id: "h", text: "Page", level: "h1", align: "center" } };
  const node = (props: Record<string, unknown>) => ({ type: "PricingPlan", props: { id: `p-${props.name}`, ...plan(), ...props } });
  const issues = (...plans: unknown[]) => checkLandingPage({ content: [title, { type: "Pricing", props: { id: "pr", items: plans } }], root: { props: {} }, schemaVersion: LANDING_SCHEMA_VERSION });

  it("is clean for a plan with a name and a button that has a link", () => {
    expect(issues(node({ name: "Starter" })).filter((i) => i.block === "Pricing")).toEqual([]);
  });

  it("makes a button with no link an error, naming the plan, and a link with no label a warning", () => {
    const missing = issues(node({ name: "Starter", href: "" })).filter((i) => i.block === "Pricing");
    expect(missing).toEqual([{ severity: "error", block: "Pricing", message: 'The button of the "Starter" plan (Choose Starter) has no link.' }]);
    const noLabel = issues(node({ name: "Starter", buttonLabel: "" })).filter((i) => i.block === "Pricing");
    expect(noLabel.map((i) => [i.severity, i.message])).toEqual([["warning", 'The "Starter" plan has a link but no button label, so the link is not shown.']]);
  });

  it("warns about a button that only says click here, and about more than one featured plan", () => {
    expect(issues(node({ name: "A", buttonLabel: "Click here" })).some((i) => i.severity === "warning" && /doesn't say where it goes/.test(i.message))).toBe(true);
    expect(issues(node({ name: "A", featured: true }), node({ name: "B", featured: true }), node({ name: "C" })).some((i) => i.message === "2 plans are marked featured; feature one, so it stands out.")).toBe(true);
    expect(issues(node({ name: "A", featured: true }), node({ name: "B" })).some((i) => /marked featured/.test(i.message))).toBe(false);
  });

  it("counts the plan name as a heading one level under the section's, and warns on more than three plans or none", () => {
    const skip = checkLandingPage({ content: [title, { type: "Pricing", props: { id: "pr", items: [node({ name: "A" })] } }], root: { props: {} }, schemaVersion: LANDING_SCHEMA_VERSION });
    expect(skip.some((i) => i.block === "Heading")).toBe(true); // h1 then h3 skips a level
    expect(issues(node({ name: "A" }), node({ name: "B" }), node({ name: "C" }), node({ name: "D" })).some((i) => i.block === "Pricing" && /shows 3 plans at most; the 1 after that/.test(i.message))).toBe(true);
    expect(issues().some((i) => i.block === "Pricing" && /no plans/.test(i.message))).toBe(true);
  });
});

describe("a Pricing block in an exported file", () => {
  it("keeps every prop of its plans through the import pruning and drops what a plan does not have", () => {
    const item = { type: "PricingPlan", props: { id: "p1", ...plan({ badge: "Most popular", featured: true }), colour: "red" } };
    const { data, droppedProps, leftOut } = pruneToKnownBlocks(normalizeLandingData({ content: [{ type: "Pricing", props: { id: "pr", items: [item], extra: 1 } }], root: {}, schemaVersion: LANDING_SCHEMA_VERSION }));
    expect(leftOut).toEqual([]);
    expect(droppedProps).toBe(2);
    const kept = (data.content[0] as unknown as { props: { items: { props: Record<string, unknown> }[] } }).props.items[0].props;
    expect(kept).toEqual({ id: "p1", ...plan({ badge: "Most popular", featured: true }) });
  });
});
