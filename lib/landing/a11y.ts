import { normalizeLandingData, parseEmbed, safeHref } from "./data";

/**
 * Checks a page before it is published (docs/LANDING_PAGES.md, "Accessibility checks"). A problem a visitor can't work
 * around (a picture with no description, a button that goes nowhere, a missing page title) is an `error` and stops the
 * publish; the rest are `warning`s the editor shows and lets through. Text and background colours come from a fixed
 * palette where each background carries a readable text colour (components/landing/theme.ts), so contrast can't fail
 * except over a picture with no shade, which is checked here.
 */
export type A11yIssue = { severity: "error" | "warning"; block: string; message: string };

type Node = { type?: string; props?: Record<string, unknown> };

const GENERIC_LINK_TEXT = /^(click here|here|read more|more|link|this link|learn more)$/i;

function walk(content: unknown[], visit: (node: Node) => void) {
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Node;
    visit(node);
    for (const [key, value] of Object.entries(node.props ?? {})) {
      // A third column that is switched off is not shown, so what is left in it is not checked either.
      if (node.type === "Columns" && key === "col3" && node.props?.count !== "3") continue;
      // A slot holds a list of blocks.
      if (Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === "object" && "type" in (v as object) && "props" in (v as object))) {
        walk(value, visit);
      }
    }
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function checkLandingPage(value: unknown): A11yIssue[] {
  const data = normalizeLandingData(value);
  const issues: A11yIssue[] = [];
  const headings: { level: number; text: string }[] = [];
  let blocks = 0;

  /** A button or link with words but no usable address is an error; one that says only "click here" a warning. */
  const checkButton = (block: string, label: unknown, href: unknown, what?: string) => {
    if (str(label) && !safeHref(href)) issues.push({ severity: "error", block, message: what ? `${what} (${str(label)}) has no link.` : `The button "${str(label)}" has no link.` });
    if (GENERIC_LINK_TEXT.test(str(label))) issues.push({ severity: "warning", block, message: `A link that says "${str(label)}" doesn't say where it goes.` });
  };
  const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : []);

  walk(data.content, (node) => {
    const p = node.props ?? {};
    const type = node.type ?? "";
    blocks += 1;
    switch (type) {
      case "Image":
      case "Split":
        if (str(p.imageAssetId) && !p.decorative && !str(p.alt)) issues.push({ severity: "error", block: type === "Split" ? "Image and text" : "Image", message: "A picture needs a description for people who can't see it, or mark it as decoration." });
        break;
      case "Hero": {
        // A picture behind the words is a background, like a Section's; a picture beside them is content and needs a description.
        if (str(p.imageAssetId) && p.imageMode === "side" && !p.decorative && !str(p.alt)) issues.push({ severity: "error", block: "Hero", message: "A picture needs a description for people who can't see it, or mark it as decoration." });
        if (str(p.imageAssetId) && p.imageMode !== "side" && p.overlay === "none") issues.push({ severity: "warning", block: "Hero", message: "Text over a picture with no shade can be hard to read. Add a dark or light shade." });
        for (const button of [p.primary, p.secondary] as Record<string, unknown>[]) {
          if (!button) continue;
          if (str(button.label) && !safeHref(button.href)) issues.push({ severity: "error", block: "Hero", message: `The button "${str(button.label)}" has no link.` });
          if (GENERIC_LINK_TEXT.test(str(button.label))) issues.push({ severity: "warning", block: "Hero", message: `A button that says "${str(button.label)}" doesn't say where it goes.` });
        }
        if (str(p.headline)) headings.push({ level: p.level === "h2" ? 2 : 1, text: str(p.headline) });
        break;
      }
      case "Steps":
        // Mirrors the block: titles are h3 under the block's own heading, h2 without one.
        if (str(p.heading)) headings.push({ level: 2, text: str(p.heading) });
        for (const step of ((p.items as Record<string, unknown>[]) ?? []).filter((i) => str(i.title))) headings.push({ level: str(p.heading) ? 3 : 2, text: str(step.title) });
        break;
      case "CtaBanner":
        if (str(p.heading)) headings.push({ level: 2, text: str(p.heading) });
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Banner", message: `The button "${str(p.label)}" has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Banner", message: `A button that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "CardGrid":
        for (const [i, card] of ((p.items as Record<string, unknown>[]) ?? []).entries()) {
          if (str(card.imageAssetId) && !str(card.alt)) issues.push({ severity: "error", block: "Card grid", message: `Card ${i + 1} has a picture with no description.` });
          if (str(card.buttonLabel) && !safeHref(card.href)) issues.push({ severity: "error", block: "Card grid", message: `Card ${i + 1}'s button has no link.` });
          if (GENERIC_LINK_TEXT.test(str(card.buttonLabel))) issues.push({ severity: "warning", block: "Card grid", message: `Card ${i + 1}'s button says "${str(card.buttonLabel)}": say where it goes.` });
        }
        break;
      case "AnnouncementStrip":
        checkButton("Announcement strip", p.buttonLabel, p.href);
        break;
      case "FinisherCards": {
        for (const [i, card] of rows(p.items).entries()) {
          if (str(card.imageAssetId) && !str(card.alt)) issues.push({ severity: "error", block: "Finisher cards", message: `Finisher ${i + 1} has a photo with no description.` });
          if (str(card.name)) headings.push({ level: 3, text: str(card.name) });
          checkButton("Finisher cards", card.linkLabel, card.href, `Finisher ${i + 1}'s link`);
        }
        const more = (p.more ?? {}) as Record<string, unknown>;
        checkButton("Finisher cards", more.label, more.href, "The link under the cards");
        break;
      }
      case "Timeline":
        if (str(p.heading)) headings.push({ level: 3, text: str(p.heading) });
        for (const item of rows(p.items).filter((i) => str(i.title))) headings.push({ level: str(p.heading) ? 4 : 3, text: str(item.title) });
        break;
      case "FinishLineCards":
        for (const card of rows(p.items).filter((i) => str(i.title))) {
          headings.push({ level: 3, text: str(card.title) });
          checkButton("Finish-line cards", card.buttonLabel, card.href);
        }
        break;
      case "PlanPhases":
        if (str(p.heading)) headings.push({ level: 3, text: str(p.heading) });
        break;
      case "JourneyMap": {
        const offer = (p.offer ?? {}) as Record<string, unknown>;
        if (str(offer.title)) headings.push({ level: 3, text: str(offer.title) });
        checkButton("Journey map", offer.buttonLabel, offer.href);
        const compare = (p.compare ?? {}) as Record<string, unknown>;
        checkButton("Journey map", compare.label, compare.href, "The compare link");
        break;
      }
      case "ComingUp":
        if (str(p.heading)) headings.push({ level: 3, text: str(p.heading) });
        for (const [i, card] of rows(p.items).entries()) {
          if (str(card.title)) headings.push({ level: str(p.heading) ? 4 : 3, text: str(card.title) });
          checkButton("Coming up", card.linkLabel, card.href, `Card ${i + 1}'s link`);
        }
        break;
      case "Heading":
        if (str(p.text)) headings.push({ level: Number(String(p.level).replace("h", "")) || 2, text: str(p.text) });
        break;
      case "Button":
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Button", message: `The button "${str(p.label)}" has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Button", message: `A button that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "ButtonRow":
        for (const button of rows(p.items)) {
          if (str(button.label) && !safeHref(button.href)) issues.push({ severity: "error", block: "Buttons", message: `The button "${str(button.label)}" has no link.` });
          if (GENERIC_LINK_TEXT.test(str(button.label))) issues.push({ severity: "warning", block: "Buttons", message: `A button that says "${str(button.label)}" doesn't say where it goes.` });
        }
        break;
      case "LinkList":
        for (const link of (p.items as Record<string, unknown>[]) ?? []) {
          if (str(link.label) && !safeHref(link.href)) issues.push({ severity: "error", block: "Link list", message: `The link "${str(link.label)}" has no address.` });
          if (GENERIC_LINK_TEXT.test(str(link.label))) issues.push({ severity: "warning", block: "Link list", message: `A link that says "${str(link.label)}" doesn't say where it goes.` });
        }
        break;
      case "Section":
        if (str(p.backgroundImageAssetId) && p.overlay === "none") issues.push({ severity: "warning", block: "Section", message: "Text over a picture with no shade can be hard to read. Add a dark or light shade." });
        break;
      case "Countdown":
        if (!str(p.targetAt)) issues.push({ severity: "error", block: "Countdown", message: "The countdown has no date." });
        break;
      case "OptInForm":
        if (!str(p.kajabiFormId)) issues.push({ severity: "error", block: "Sign-up form", message: "The sign-up form has no Kajabi form chosen, so it would not show." });
        if (!str(p.buttonLabel)) issues.push({ severity: "warning", block: "Sign-up form", message: "The sign-up button has no label." });
        break;
      case "Video":
        if (str(p.url) && !parseEmbed(p.url)) issues.push({ severity: "error", block: "Video", message: "This video link isn't from YouTube, Vimeo or Mux, so it can't be shown." });
        if (str(p.url) && !str(p.title)) issues.push({ severity: "warning", block: "Video", message: "Give the video a title for screen readers." });
        break;
      default:
    }
  });

  if (blocks === 0) issues.push({ severity: "error", block: "Page", message: "The page is empty." });
  const h1s = headings.filter((h) => h.level === 1);
  if (blocks > 0 && h1s.length === 0) issues.push({ severity: "error", block: "Page", message: "The page needs one title: add a Heading set to Page title (h1)." });
  if (h1s.length > 1) issues.push({ severity: "warning", block: "Page", message: "There is more than one page title (h1). Use Section heading for the others." });
  let previous = 0;
  for (const h of headings) {
    if (previous > 0 && h.level > previous + 1) issues.push({ severity: "warning", block: "Heading", message: `"${h.text}" skips a level (h${previous} to h${h.level}). Headings should go down one step at a time.` });
    previous = h.level;
  }
  return issues;
}
