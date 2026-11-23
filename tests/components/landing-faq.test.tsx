// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { checkLandingPage } from "@/lib/landing/a11y";
import { faqStructuredData } from "@/lib/landing/faq-schema";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const question = (id: string, q: string, a: string) => ({ type: "FaqQuestion", props: { id, question: q, answer: a } });
const faq = (id: string, items: unknown[]) => ({ type: "Faq", props: { id, items } });
const title = { type: "Heading", props: { id: "h", text: "Page", level: "h1", align: "center" } };
const doc = (...content: unknown[]) => ({ content, root: { props: {} }, schemaVersion: LANDING_SCHEMA_VERSION });

async function renderPage(data: unknown, structuredData?: boolean) {
  globalThis.ResizeObserver = ResizeObserverStub as never;
  const { default: LandingRender } = await import("@/components/landing/LandingRender");
  return render(<LandingRender data={data} structuredData={structuredData} />);
}
const jsonLd = (container: HTMLElement) => [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? ""));

describe("the FAQ's structured data (faqStructuredData)", () => {
  it("lists every answered question of every FAQ on the page as one FAQPage, in order", () => {
    const data = faqStructuredData(doc(faq("f1", [question("a", "Is it free?", "Yes."), question("b", "Why?", "Because.")]), title, faq("f2", [question("c", "When?", "Now.")])));
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Is it free?", acceptedAnswer: { "@type": "Answer", text: "Yes." } },
        { "@type": "Question", name: "Why?", acceptedAnswer: { "@type": "Answer", text: "Because." } },
        { "@type": "Question", name: "When?", acceptedAnswer: { "@type": "Answer", text: "Now." } },
      ],
    });
  });

  it("gives nothing for an empty FAQ, a question with no answer, an Accordion, or no document", () => {
    expect(faqStructuredData(doc(faq("f", [])))).toBeNull();
    expect(faqStructuredData(doc(faq("f", [question("a", "Open?", ""), question("b", "", "Orphan answer"), question("c", "  ", "  ")])))).toBeNull();
    expect(faqStructuredData(doc({ type: "Accordion", props: { id: "x", items: [{ type: "AccordionItem", props: { id: "i", title: "T", text: "X", open: false } }] } }))).toBeNull();
    expect(faqStructuredData(null)).toBeNull();
    expect(faqStructuredData({})).toBeNull();
  });

  it("keeps the answered questions and skips the unanswered ones in the same FAQ", () => {
    const data = faqStructuredData(doc(faq("f", [question("a", "Open?", ""), question("b", "Answered?", "Yes.")])));
    expect((data?.mainEntity as unknown[]).length).toBe(1);
  });

  it("skips a section hidden on every screen, but not one hidden on only one, and finds a FAQ in a Section and in Columns", () => {
    const section = (id: string, hide: { hideOnDesktop: boolean; hideOnMobile: boolean }, ...content: unknown[]) => ({ type: "Section", props: { id, ...hide, content } });
    const hiddenEverywhere = section("s1", { hideOnDesktop: true, hideOnMobile: true }, faq("f1", [question("a", "Hidden?", "Yes.")]));
    const hiddenOnPhone = section("s2", { hideOnDesktop: false, hideOnMobile: true }, faq("f2", [question("b", "Desktop only?", "Yes.")]));
    const inColumns = { type: "Columns", props: { id: "c", count: "2", col1: [faq("f3", [question("c", "In a column?", "Yes.")])], col2: [], col3: [faq("f4", [question("d", "Switched-off column?", "Yes.")])] } };
    const names = (faqStructuredData(doc(hiddenEverywhere, hiddenOnPhone, inColumns))?.mainEntity as { name: string }[]).map((q) => q.name);
    expect(names).toEqual(["Desktop only?", "In a column?"]);
    const three = { type: "Columns", props: { ...inColumns.props, count: "3" } };
    expect((faqStructuredData(doc({ ...inColumns, props: three.props }))?.mainEntity as unknown[]).length).toBe(2);
  });
});

describe("the public render of a FAQ", () => {
  it("adds one FAQPage script only when asked to (the published route), never in the preview", async () => {
    const page = doc(title, faq("f", [question("a", "Is it free?", "Yes.")]));
    const withData = await renderPage(page, true);
    const [ld, ...rest] = jsonLd(withData.container.parentElement ?? withData.container);
    expect(rest).toEqual([]);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity[0].name).toBe("Is it free?");
    expect(screen.getByText("Is it free?")).toBeInTheDocument();
    withData.unmount();
    const without = await renderPage(page);
    expect(jsonLd(without.container.parentElement ?? without.container)).toEqual([]);
    expect(screen.getByText("Is it free?")).toBeInTheDocument();
  });

  it("escapes a < in the text, so words in a question can never close the script", async () => {
    const view = await renderPage(doc(title, faq("f", [question("a", "Does </script><b>x</b> work?", "Use a < b.")])), true);
    const script = view.container.parentElement!.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain("<");
    expect(script.innerHTML).toContain("\\u003c/script>");
    expect(JSON.parse(script.textContent ?? "").mainEntity[0].name).toBe("Does </script><b>x</b> work?");
  });

  it("emits nothing for an empty FAQ or one with no answers, and never for an Accordion", async () => {
    const empty = await renderPage(doc(title, faq("f", [question("a", "Open?", "")]), { type: "Accordion", props: { id: "x", items: [{ type: "AccordionItem", props: { id: "i", title: "Fold", text: "Words", open: false } }] } }), true);
    expect(jsonLd(empty.container.parentElement ?? empty.container)).toEqual([]);
    expect(screen.getByText("Fold")).toBeInTheDocument();
  });
});

describe("pages stored before the FAQ became the Accordion", () => {
  it("still render, looking the same: the same words in the same disclosure boxes, now as an Accordion, with no structured data", async () => {
    const stored = {
      schemaVersion: 3,
      content: [title, { type: "Faq", props: { id: "old", items: [{ type: "FaqItem", props: { id: "q1", question: "Is it for me?", answer: "Yes.\nReally." } }, { type: "FaqItem", props: { id: "q2", question: "How long?", answer: "Ten months." } }] } }],
      root: { props: {} },
    };
    const view = await renderPage(stored, true);
    const boxes = view.container.querySelectorAll("details");
    expect([...boxes].map((d) => d.querySelector("summary")?.textContent)).toEqual(["Is it for me?+", "How long?+"]);
    expect(boxes[0].querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("Ten months.")).toBeInTheDocument();
    expect(jsonLd(view.container.parentElement ?? view.container)).toEqual([]);
  });
});

describe("the publish check for a FAQ and an Accordion", () => {
  const issues = (block: unknown) => checkLandingPage(doc(title, block));

  it("warns, naming the count, when a FAQ has questions with no answer, and not when all are answered", () => {
    expect(issues(faq("f", [question("a", "Open?", ""), question("b", "Fine?", "Yes.")])).filter((i) => i.block === "FAQ").map((i) => [i.severity, i.message])).toEqual([["warning", "A question has no answer, so it is left out of what search engines are told about this FAQ."]]);
    expect(issues(faq("f", [question("a", "Open?", ""), question("b", "Also open?", "")])).find((i) => i.block === "FAQ")?.message).toContain("2 questions have no answer");
    expect(issues(faq("f", [question("a", "Fine?", "Yes.")])).filter((i) => i.block === "FAQ")).toEqual([]);
  });

  it("warns that an empty FAQ or Accordion shows nothing", () => {
    expect(issues(faq("f", [])).some((i) => i.block === "FAQ" && /no questions/.test(i.message))).toBe(true);
    expect(issues({ type: "Accordion", props: { id: "a", items: [] } }).some((i) => i.block === "Accordion" && /no items/.test(i.message))).toBe(true);
    expect(issues({ type: "Accordion", props: { id: "a", items: [{ type: "AccordionItem", props: { id: "i", title: "T", text: "", open: false } }] } }).filter((i) => i.block === "Accordion")).toEqual([]);
  });
});
