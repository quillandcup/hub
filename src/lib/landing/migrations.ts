/**
 * Landing page data migrations (docs/product/LANDING_PAGES.md, "Changing a block's props"). Stored page JSON outlives the
 * code that wrote it: draft, published copy and every saved version keep the props a block had when they were saved.
 * Rename or reshape a prop and old rows would render wrongly or lose content, so each such change is a step here.
 *
 * The document carries `schemaVersion`; unmarked data is version 0. `migrateLandingData` runs the steps above the
 * document's version and stamps the current one. It runs wherever a stored document is read (`normalizeLandingData`),
 * so the editor, the public page, restore and copy all see current props, and the next save writes them back.
 * Pure: safe in the browser and on the server. Steps must be idempotent (running one twice changes nothing more).
 */

type Props = Record<string, unknown>;

export type LandingMigration = {
  /** The version this step produces; steps are numbered 1, 2, 3 in order, with no gaps. */
  version: number;
  /** One function per block name, given that block's props, returning the new props. A block not listed is untouched. */
  blocks?: Record<string, (props: Props) => Props>;
  /** The page frame's props (`root.props`). */
  root?: (props: Props) => Props;
  /**
   * Gives a block a new type name, from its old type and props (undefined keeps it). `blocks` is still looked up by the OLD type, and
   * its result is the props of the renamed block. A rename must be safe to run again (see step 4).
   */
  retype?: (type: string, props: Props) => string | undefined;
};

const isObject = (v: unknown): v is Props => !!v && typeof v === "object" && !Array.isArray(v);

/** Step 1. Without an `offer` prop there is nothing to move (already migrated, or a new block), so running it again changes nothing. */
function journeyMapOfferToStage(props: Props): Props {
  if (!("offer" in props)) return props;
  const { offer, ...rest } = props;
  const stages = Array.isArray(rest.stages) ? rest.stages.filter(isObject) : [];
  const hasContent = isObject(offer) && (typeof offer.title === "string" ? offer.title.trim() : "") + (typeof offer.text === "string" ? offer.text.trim() : "") !== "";
  if (!hasContent || stages.length === 0) return { ...rest, stages: Array.isArray(rest.stages) ? rest.stages : stages };
  const named = stages.filter((s) => typeof s.name === "string" && s.name.trim() !== "");
  // The block shows only named stages, so the offer goes to the current one among them (else the first).
  const target = named.find((s) => s.current === true) ?? named[0] ?? stages[0];
  const moved = {
    status: offer.status,
    statusLabel: offer.statusLabel ?? "",
    title: offer.title ?? "",
    text: offer.text ?? "",
    buttonLabel: offer.buttonLabel ?? "",
    href: offer.href ?? "",
  };
  return {
    ...rest,
    stages: stages.map((s) => (s === target ? { ...s, offers: [moved, ...(Array.isArray(s.offers) ? s.offers : [])].slice(0, 4) } : s)),
  };
}

/**
 * Step 2. These blocks used to hold their items as a plain list of props; they now hold them as a slot of child blocks
 * (`{ type: <item type>, props: { id, ...the item's props } }`, docs/product/LANDING_PAGES.md, "Blocks with items"), and Puck throws
 * on a list item that is not a block. The item's props keep their names, so the conversion only wraps each one and gives it an id
 * made from its parent's (stable, so running the step again, or on a copy of the page, gives the same ids). A list that is
 * already blocks, or empty, is left alone, which makes the step idempotent.
 */
const ITEM_BLOCK_OF: Record<string, string> = {
  Steps: "Step",
  Stats: "Stat",
  FinisherCards: "FinisherCard",
  Timeline: "TimelineMoment",
  WeekStrip: "WeekDay",
  FinishLineCards: "FinishLineCard",
  PlanPhases: "PlanPhase",
};

function itemsToChildBlocks(itemType: string) {
  return (props: Props): Props => {
    const items = props.items;
    if (!Array.isArray(items) || items.length === 0 || items.some(isNode) || !items.every(isObject)) return props;
    const parent = typeof props.id === "string" && props.id ? props.id : itemType;
    return { ...props, items: items.map((item, i) => ({ type: itemType, props: { ...item, id: `${itemType}-${parent}-${i + 1}` } })) };
  };
}

/** Step 3's blocks: the same wrapping, for the eight more blocks whose items became child blocks. */
const ITEM_BLOCK_OF_STEP_3: Record<string, string> = {
  ButtonRow: "RowButton",
  List: "ListItem",
  Testimonials: "Testimonial",
  Faq: "FaqItem",
  CardGrid: "GridCard",
  OutcomeNumbers: "OutcomeNumber",
};

/** A Link list's style and colour were the list's; each link has its own now. Once they are gone from the list there is nothing to move, so running it again changes nothing. */
function linkListToChildBlocks(props: Props): Props {
  const { look, color, ...rest } = props;
  const items = Array.isArray(rest.items) ? rest.items.map((item) => (isObject(item) && !isNode(item) ? { look: look ?? "solid", color: color ?? "plum", ...item } : item)) : rest.items;
  return itemsToChildBlocks("LinkItem")(items === undefined ? rest : { ...rest, items });
}

/** The Schedule panel's typed `rows` became its `items` slot of `ScheduleRow` blocks. Without a `rows` prop there is nothing to move. */
function scheduleRowsToChildBlocks(props: Props): Props {
  if (!("rows" in props)) return props;
  const { rows, ...rest } = props;
  if (Array.isArray(rest.items) && rest.items.some(isNode)) return rest;
  return itemsToChildBlocks("ScheduleRow")({ ...rest, items: Array.isArray(rows) ? rows : [] });
}

/**
 * Step 4. The block called "FAQ" was a generic collapsible list, so it is now the Accordion (`Faq` -> `Accordion`, `FaqItem` -> `AccordionItem`,
 * the item's `question` and `answer` -> `title` and `text`), and `Faq` is a new block of questions and answers (its items are `FaqQuestion`).
 * Only a `Faq` that holds the old items (`FaqItem`, or none) is renamed, so a new FAQ is never turned into an Accordion by running this
 * step on a document that lost its version marker: that is what makes the step idempotent.
 */
const isOldFaq = (props: Props): boolean => !Array.isArray(props.items) || props.items.every((i) => !isObject(i) || i.type !== "FaqQuestion");
function faqItemToAccordionItem(props: Props): Props {
  if (!("question" in props) && !("answer" in props)) return props;
  const { question, answer, ...rest } = props;
  return { ...rest, title: question ?? "", text: answer ?? "", open: false };
}

/** Append a step to change a block's props; never edit or remove an earlier one. */
export const LANDING_MIGRATIONS: LandingMigration[] = [
  {
    // Journey map: the one `offer` under the stepper becomes the offers of a stage (the one marked current, else the first).
    version: 1,
    blocks: { JourneyMap: journeyMapOfferToStage },
  },
  {
    // The items of Steps, Stats, Finisher cards, Timeline, Week strip, Finish-line cards and Plan phases become child blocks (#1600).
    version: 2,
    blocks: Object.fromEntries(Object.entries(ITEM_BLOCK_OF).map(([parent, item]) => [parent, itemsToChildBlocks(item)])),
  },
  {
    // The items of Buttons, List, Testimonials, FAQ, Card grid, Link list, Outcome numbers and the Schedule panel's rows become child blocks.
    version: 3,
    blocks: {
      ...Object.fromEntries(Object.entries(ITEM_BLOCK_OF_STEP_3).map(([parent, item]) => [parent, itemsToChildBlocks(item)])),
      LinkList: linkListToChildBlocks,
      SchedulePanel: scheduleRowsToChildBlocks,
    },
  },
  {
    // The generic "FAQ" list becomes the Accordion; "FAQ" is now a block of questions and answers that search engines are told about too.
    version: 4,
    retype: (type, props) => (type === "FaqItem" ? "AccordionItem" : type === "Faq" && isOldFaq(props) ? "Accordion" : undefined),
    blocks: { FaqItem: faqItemToAccordionItem },
  },
];

export const LANDING_SCHEMA_VERSION = LANDING_MIGRATIONS.length;

/** A block as Puck stores it: `{ type, props }`. */
const isNode = (v: unknown): v is { type: string; props: Props } => isObject(v) && typeof v.type === "string" && isObject(v.props);

function migrateNode(node: { type: string; props: Props }, step: LandingMigration): { type: string; props: Props } {
  // Own entries only: the type comes from stored JSON, and "constructor" or "toString" must not find a function on the prototype.
  const transform = step.blocks && Object.hasOwn(step.blocks, node.type) ? step.blocks[node.type] : undefined;
  const props = transform ? transform(node.props) : node.props;
  const type = step.retype?.(node.type, node.props) ?? node.type;
  return { ...node, type, props: migrateSlots(props, step) };
}

/** Blocks nested in a prop (a Section's `content` slot) are migrated too. */
function migrateSlots(props: Props, step: LandingMigration): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = Array.isArray(value) && value.length > 0 && value.every(isNode) ? value.map((n) => migrateNode(n, step)) : value;
  }
  return out;
}

function migrateList(list: unknown, step: LandingMigration): unknown {
  return Array.isArray(list) ? list.map((n) => (isNode(n) ? migrateNode(n, step) : n)) : list;
}

/** The version a stored document is at: its marker, or 0 when it has none (written before migrations existed). */
export function landingDataVersion(value: unknown): number {
  const v = isObject(value) ? value.schemaVersion : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** The document brought up to the current version and stamped with it. Expects the shape `normalizeLandingData` returns. */
export function migrateLandingData<T extends { content: unknown[]; root: Props; zones?: Record<string, unknown[]> }>(
  data: T,
  steps: LandingMigration[] = LANDING_MIGRATIONS,
): T & { schemaVersion: number } {
  const target = steps.length;
  let current: T = data;
  for (const step of steps.filter((s) => s.version > landingDataVersion(data))) {
    const rootProps = isObject(current.root.props) ? current.root.props : undefined;
    const root = step.root && rootProps ? { ...current.root, props: step.root(rootProps) } : current.root;
    const zones = current.zones && isObject(current.zones) ? Object.fromEntries(Object.entries(current.zones).map(([k, list]) => [k, migrateList(list, step) as unknown[]])) : current.zones;
    current = { ...current, root, content: migrateList(current.content, step) as unknown[], ...(zones ? { zones } : {}) };
  }
  return { ...current, schemaVersion: target };
}

/** Marks a document the editor produced as current: it was migrated on load, and Puck may drop the marker on the way back. */
export function stampLandingVersion(value: unknown): unknown {
  return isObject(value) ? { ...value, schemaVersion: LANDING_SCHEMA_VERSION } : value;
}
