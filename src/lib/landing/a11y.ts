import { ITEM_LIMITS } from "@/components/landing/item-limits";
import { buttonStyleProblems } from "./button-contrast";
import { normalizeLandingData, parseEmbed, safeHref } from "./data";
import { featuredOfferIndex } from "./journey";
import { COMING_UP_LIST_HEADING } from "./live-kinds";
import { normalizeStyleOverride, pageOverrides, resolveStyle } from "./style";

/**
 * Checks a page before it is published (docs/product/LANDING_PAGES.md, "Accessibility checks"). A problem a visitor can't work
 * around (a picture with no description, a button that goes nowhere, a missing page title) is an `error` and stops the
 * publish; the rest are `warning`s the editor shows and lets through. Text and background colours come from a fixed
 * palette where each background carries a readable text colour (src/components/landing/theme.ts), so contrast can't fail
 * except over a picture with no shade, which is checked here.
 */
export type A11yIssue = { severity: "error" | "warning"; block: string; message: string };

type Node = { type?: string; props?: Record<string, unknown> };

const GENERIC_LINK_TEXT = /^(click here|here|read more|more|link|this link|learn more)$/i;

/** Where a block sits: the type of the block whose slot holds it, and its place (from 0) among its neighbours there. */
type Place = { parent?: string; index: number };

function walk(content: unknown[], visit: (node: Node, place: Place) => void, parent?: string) {
  for (const [index, raw] of content.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Node;
    visit(node, { parent, index });
    for (const [key, value] of Object.entries(node.props ?? {})) {
      // A third column that is switched off is not shown, so what is left in it is not checked either.
      if (node.type === "Columns" && key === "col3" && node.props?.count !== "3") continue;
      // A slot holds a list of blocks.
      if (Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === "object" && "type" in (v as object) && "props" in (v as object))) {
        walk(value, visit, node.type);
      }
    }
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The blocks that hold a list of items as child blocks (src/components/landing/config.tsx, `SLOT_ALLOW`): what the block is
 * called, what one item is called, the item type and the prop the public page needs before it shows one. An empty list, or
 * more items than the layout is made for, is worth a warning: the block would show nothing, or hide the extra ones.
 */
const ITEM_BLOCKS: Record<string, { block: string; noun: string; plural: string; item: string; key: string; limit?: number; liveOk?: boolean; shown?: (props: Record<string, unknown>) => boolean }> = {
  Steps: { block: "Steps", noun: "step", plural: "steps", item: "Step", key: "title", limit: ITEM_LIMITS.Steps },
  Stats: { block: "Stats", noun: "figure", plural: "figures", item: "Stat", key: "value", limit: ITEM_LIMITS.Stats },
  FinisherCards: { block: "Finisher cards", noun: "Finisher", plural: "Finishers", item: "FinisherCard", key: "name", limit: ITEM_LIMITS.FinisherCards },
  Timeline: { block: "Timeline", noun: "moment", plural: "moments", item: "TimelineMoment", key: "title", limit: ITEM_LIMITS.Timeline },
  WeekStrip: { block: "Week strip", noun: "day", plural: "days", item: "WeekDay", key: "label", limit: ITEM_LIMITS.WeekStrip },
  FinishLineCards: { block: "Finish-line cards", noun: "finish line", plural: "finish lines", item: "FinishLineCard", key: "title", limit: ITEM_LIMITS.FinishLineCards },
  PlanPhases: { block: "Plan phases", noun: "phase", plural: "phases", item: "PlanPhase", key: "title", limit: ITEM_LIMITS.PlanPhases },
  ButtonRow: { block: "Buttons", noun: "button", plural: "buttons", item: "RowButton", key: "label", limit: ITEM_LIMITS.ButtonRow },
  List: { block: "List", noun: "item", plural: "items", item: "ListItem", key: "text" },
  Testimonials: { block: "Testimonials", noun: "testimonial", plural: "testimonials", item: "Testimonial", key: "quote" },
  Faq: { block: "FAQ", noun: "question", plural: "questions", item: "FaqItem", key: "question" },
  CardGrid: { block: "Card grid", noun: "card", plural: "cards", item: "GridCard", key: "title" },
  LinkList: { block: "Link list", noun: "link", plural: "links", item: "LinkItem", key: "label" },
  // A live panel falls back to its typed sessions only when the live read fails, so having none is not worth a warning there.
  SchedulePanel: { block: "Schedule panel", noun: "session", plural: "sessions", item: "ScheduleRow", key: "title", limit: ITEM_LIMITS.SchedulePanel, liveOk: true },
  // A figure that is live shows with no typed value.
  OutcomeNumbers: { block: "Outcome numbers", noun: "figure", plural: "figures", item: "OutcomeNumber", key: "value", limit: ITEM_LIMITS.OutcomeNumbers, shown: (i) => Boolean(str(i.value)) || (i.source === "live" && Boolean(str(i.stat))) },
};
/** The parent of each item type, to say what an item standing alone needs. */
const ITEM_PARENT = Object.fromEntries(Object.entries(ITEM_BLOCKS).map(([parent, rule]) => [rule.item, parent]));

/**
 * `siteStyle` is the site's style tokens (a website page follows them). A page with its own style (`styleOverride`) is also checked
 * for readable buttons, as the site's own style is when the site design is published (`siteTemplateIssues`); a page that follows
 * the site is not checked here, the site's check covers it. It is a warning: the page's own style is the editor's to weigh.
 */
export function checkLandingPage(value: unknown, siteStyle?: unknown): A11yIssue[] {
  const data = normalizeLandingData(value);
  const issues: A11yIssue[] = [];
  const override = pageOverrides(data).style;
  if (normalizeStyleOverride(override)) {
    for (const message of buttonStyleProblems(resolveStyle(normalizeStyleOverride(siteStyle), override))) issues.push({ severity: "warning", block: "Page style", message });
  }
  const headings: { level: number; text: string }[] = [];
  let blocks = 0;

  /** A button or link with words but no usable address is an error; one that says only "click here" a warning. */
  const checkButton = (block: string, label: unknown, href: unknown, what?: string) => {
    if (str(label) && !safeHref(href)) issues.push({ severity: "error", block, message: what ? `${what} (${str(label)}) has no link.` : `The button "${str(label)}" has no link.` });
    if (GENERIC_LINK_TEXT.test(str(label))) issues.push({ severity: "warning", block, message: `A link that says "${str(label)}" doesn't say where it goes.` });
  };
  const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : []);

  walk(data.content, (node, place) => {
    const p = node.props ?? {};
    const type = node.type ?? "";
    blocks += 1;
    const owner = ITEM_PARENT[type];
    // An item (a step, a Finisher card) belongs inside its block's list; on its own it is drawn as a bare piece of it.
    if (owner && place.parent !== owner) issues.push({ severity: "warning", block: ITEM_BLOCKS[owner].block, message: `A ${ITEM_BLOCKS[owner].noun} is outside a ${ITEM_BLOCKS[owner].block} block. Drag it into one, or delete it.` });
    const list = ITEM_BLOCKS[type];
    if (list) {
      const shown = (Array.isArray(p.items) ? (p.items as Node[]) : []).filter((i) => i?.type === list.item && (list.shown ? list.shown(i.props ?? {}) : str(i.props?.[list.key])));
      if (shown.length === 0 && !(list.liveOk && p.source === "live")) issues.push({ severity: "warning", block: list.block, message: `${list.block} has no ${list.plural}, so it shows nothing. Drag one in from "Parts of a block".` });
      if (list.limit !== undefined && shown.length > list.limit) issues.push({ severity: "warning", block: list.block, message: `${list.block} shows ${list.limit} ${list.plural} at most; the ${shown.length - list.limit} after that are hidden.` });
    }
    // "Finisher 2" by its place in its block's list; one standing on its own has no place to number it by.
    const finisher = place.parent === "FinisherCards" ? `Finisher ${place.index + 1}` : "A Finisher";
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
        // Mirrors the block: its heading is an h2, and each step's title an h3.
        if (str(p.heading)) headings.push({ level: 2, text: str(p.heading) });
        break;
      case "Step":
        // Always a level below the block's heading (h2), so a Steps block with no heading still sits under the section's.
        if (str(p.title)) headings.push({ level: 3, text: str(p.title) });
        break;
      case "CtaBanner":
        if (str(p.heading)) headings.push({ level: 2, text: str(p.heading) });
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Banner", message: `The button "${str(p.label)}" has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Banner", message: `A button that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "GridCard": {
        // "Card 2" by its place in the grid; one standing on its own has no place to number it by.
        const card = place.parent === "CardGrid" ? `Card ${place.index + 1}` : "A card";
        if (str(p.imageAssetId) && !str(p.alt)) issues.push({ severity: "error", block: "Card grid", message: `${card} has a picture with no description.` });
        if (str(p.buttonLabel) && !safeHref(p.href)) issues.push({ severity: "error", block: "Card grid", message: `${card}'s button has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.buttonLabel))) issues.push({ severity: "warning", block: "Card grid", message: `${card}'s button says "${str(p.buttonLabel)}": say where it goes.` });
        break;
      }
      case "AnnouncementStrip":
        checkButton("Announcement strip", p.buttonLabel, p.href);
        break;
      case "FinisherCard":
        if (str(p.imageAssetId) && !str(p.alt)) issues.push({ severity: "error", block: "Finisher cards", message: `${finisher} has a photo with no description.` });
        if (str(p.name)) headings.push({ level: 3, text: str(p.name) });
        checkButton("Finisher cards", p.linkLabel, p.href, `${finisher}'s link`);
        break;
      case "FinisherCards": {
        const more = (p.more ?? {}) as Record<string, unknown>;
        checkButton("Finisher cards", more.label, more.href, "The link under the cards");
        break;
      }
      case "Timeline":
        if (str(p.heading)) headings.push({ level: 3, text: str(p.heading) });
        break;
      case "TimelineMoment":
        if (str(p.title)) headings.push({ level: 3, text: str(p.title) });
        break;
      case "FinishLineCard":
        if (str(p.title)) {
          headings.push({ level: 3, text: str(p.title) });
          checkButton("Finish-line cards", p.buttonLabel, p.href);
        }
        break;
      case "PlanPhases":
        if (str(p.heading)) headings.push({ level: 3, text: str(p.heading) });
        break;
      case "JourneyMap": {
        const seen = new Set<string>();
        for (const [i, stage] of rows(p.stages).entries()) {
          const name = str(stage.name);
          const offers = rows(stage.offers);
          if (!name) {
            // The block shows only named stages, so one with words but no name would lose them.
            if (str(stage.helps) || str(stage.note) || offers.some((o) => str(o.title) || str(o.text))) issues.push({ severity: "error", block: "Journey map", message: `Stage ${i + 1} has no name, so it is not shown.` });
            continue;
          }
          if (seen.has(name.toLowerCase())) issues.push({ severity: "warning", block: "Journey map", message: `Two stages are called "${name}".` });
          seen.add(name.toLowerCase());
          // Offers show only with a title. Only the featured one (the one marked, else the first) is a heading under the section's; the others are a short list of links.
          const shown = offers.filter((o) => str(o.title)).slice(0, 4);
          if (shown.length > 0) headings.push({ level: 3, text: str(shown[featuredOfferIndex(shown)].title) });
          for (const offer of shown) {
            checkButton("Journey map", offer.buttonLabel, offer.href, `The "${str(offer.title)}" button in ${name}`);
          }
          const link = (stage.link ?? {}) as Record<string, unknown>;
          checkButton("Journey map", link.label, link.href, `The link for ${name}`);
        }
        const compare = (p.compare ?? {}) as Record<string, unknown>;
        checkButton("Journey map", compare.label, compare.href, "The compare link");
        break;
      }
      case "ComingUp": {
        // The same heading the block draws: a list never given one says "Upcoming sessions" (src/components/landing/homepage-blocks.tsx).
        const heading = p.heading === undefined && p.style === "list" ? COMING_UP_LIST_HEADING : str(p.heading);
        if (heading) headings.push({ level: 3, text: heading });
        for (const [i, card] of rows(p.items).entries()) {
          if (str(card.title)) headings.push({ level: heading ? 4 : 3, text: str(card.title) });
          checkButton("Coming up", card.linkLabel, card.href, `Card ${i + 1}'s link`);
        }
        break;
      }
      case "Heading":
        if (str(p.text)) headings.push({ level: Number(String(p.level).replace("h", "")) || 2, text: str(p.text) });
        break;
      case "Button":
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Button", message: `The button "${str(p.label)}" has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Button", message: `A button that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "RowButton":
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Buttons", message: `The button "${str(p.label)}" has no link.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Buttons", message: `A button that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "LinkItem":
        if (str(p.label) && !safeHref(p.href)) issues.push({ severity: "error", block: "Link list", message: `The link "${str(p.label)}" has no address.` });
        if (GENERIC_LINK_TEXT.test(str(p.label))) issues.push({ severity: "warning", block: "Link list", message: `A link that says "${str(p.label)}" doesn't say where it goes.` });
        break;
      case "Section":
        if (str(p.backgroundImageAssetId) && p.overlay === "none") issues.push({ severity: "warning", block: "Section", message: "Text over a picture with no shade can be hard to read. Add a dark or light shade." });
        if (p.hideOnDesktop === true && p.hideOnMobile === true) issues.push({ severity: "warning", block: "Section", message: "A section is hidden on desktop and on mobile, so nobody sees it." });
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
