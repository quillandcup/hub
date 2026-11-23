import { isBlock, isObject, type StoredBlock } from "./walk";

/**
 * The schema.org `FAQPage` a published page tells search engines (docs/product/LANDING_PAGES.md, "Accordion and FAQ"): every
 * question with an answer in the page's FAQ blocks, as one list, because a page has one FAQPage. Built from the stored document (the
 * public render passes the cleaned one), not from what a block draws, so it follows what a visitor can see: a section hidden on every
 * screen size, and a third column that is switched off, are skipped, and so is a question without an answer. A page with no such
 * question gets nothing (`null`), never an empty FAQPage.
 */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The blocks a visitor can see: the walk leaves out a Section hidden on desktop and mobile, and a Columns block's third column when it is off. */
function* visibleBlocks(value: unknown): Generator<StoredBlock> {
  if (Array.isArray(value)) {
    for (const v of value) yield* visibleBlocks(v);
    return;
  }
  if (!isBlock(value)) return;
  yield value;
  const { type, props } = value;
  if (type === "Section" && props.hideOnDesktop === true && props.hideOnMobile === true) return;
  for (const [key, inner] of Object.entries(props)) {
    if (type === "Columns" && key === "col3" && props.count !== "3") continue;
    if (Array.isArray(inner)) yield* visibleBlocks(inner);
  }
}

/** The FAQPage for a document, or null when it has no answered question that a visitor can see. */
export function faqStructuredData(data: { content?: unknown; zones?: unknown } | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  // A hidden Section is not descended into, so what is in the set is what a visitor can see.
  const visible = new Set<StoredBlock>(visibleBlocks(data.content));
  for (const zone of isObject(data.zones) ? Object.values(data.zones) : []) for (const block of visibleBlocks(zone)) visible.add(block);
  const questions: Record<string, unknown>[] = [];
  for (const block of visible) {
    if (block.type !== "Faq") continue;
    for (const item of Array.isArray(block.props.items) ? block.props.items : []) {
      if (!isBlock(item) || item.type !== "FaqQuestion") continue;
      const question = str(item.props.question);
      const answer = str(item.props.answer);
      if (question && answer) questions.push({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } });
    }
  }
  return questions.length === 0 ? null : { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions };
}
