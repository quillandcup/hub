import { KAJABI_ADMIN_OFFER_URL } from "@/lib/config";
import type { BillingRepository } from "@/lib/data/billing";
import type { CourseRepository } from "@/lib/data/courses";
import type { EventRepository } from "@/lib/data/events";
import type { KajabiCourseRepository } from "@/lib/data/kajabi-courses";
import type { ProgramRepository } from "@/lib/data/programs";

export type OfferResourceKind = "event" | "course" | "program";

/** A Hub resource that a Kajabi offer sells or grants. */
export interface OfferResource {
  kind: OfferResourceKind;
  title: string;
  /** The admin page that edits the resource. */
  href: string;
}

export interface OfferCoverageRow {
  offerId: string;
  name: string;
  status: string | null;
  /** The offer in the Kajabi admin, or null when its record has no site id. */
  kajabiUrl: string | null;
  /** The offer's public checkout page, or null. */
  checkoutUrl: string | null;
  resources: OfferResource[];
}

/** "mapped" = exactly one resource; "unmapped" = an open TODO; "multiple" = needs a decision. */
export type OfferCoverageState = "mapped" | "unmapped" | "multiple";

export function coverageState(row: Pick<OfferCoverageRow, "resources">): OfferCoverageState {
  if (row.resources.length === 0) return "unmapped";
  return row.resources.length === 1 ? "mapped" : "multiple";
}

interface Inputs {
  offers: { kajabi_offer_id: string; name: string | null; status: string | null; data?: unknown }[];
  /** Event links: an offer sells at most one event. */
  eventLinks: { kajabi_offer_id: string; event: { slug: string; title: string } }[];
  /** Courses the Kajabi import made, with the offers that grant them (by offer id). */
  courseLinks: { offerId: string; course: { id: string; title: string } }[];
  /** Programs, which list their offers by name. */
  programs: { id: string; name: string; kajabi_offer_names: string[] }[];
}

/** The site id and checkout page in Kajabi's record of an offer. */
function kajabiLinksOf(data: unknown): { siteId: string | null; checkoutUrl: string | null } {
  const record = data as { attributes?: { checkout_url?: unknown }; relationships?: { site?: { data?: { id?: unknown } } } } | null;
  const siteId = record?.relationships?.site?.data?.id;
  const checkoutUrl = record?.attributes?.checkout_url;
  return { siteId: typeof siteId === "string" ? siteId : null, checkoutUrl: typeof checkoutUrl === "string" ? checkoutUrl : null };
}

/** Every offer with the resources that point at it, unmapped first, then by name. */
export function buildOfferCoverage({ offers, eventLinks, courseLinks, programs }: Inputs): OfferCoverageRow[] {
  const rows = offers.map<OfferCoverageRow>((o) => {
    const name = o.name?.trim() || o.kajabi_offer_id;
    const resources: OfferResource[] = [];
    for (const l of eventLinks) {
      if (l.kajabi_offer_id === o.kajabi_offer_id) resources.push({ kind: "event", title: l.event.title, href: `/admin/events/${l.event.slug}` });
    }
    for (const l of courseLinks) {
      if (l.offerId === o.kajabi_offer_id) resources.push({ kind: "course", title: l.course.title, href: `/admin/courses/${l.course.id}` });
    }
    // Programs link by offer name, so every offer with that name is covered.
    for (const p of programs) {
      if (o.name && p.kajabi_offer_names.includes(o.name)) resources.push({ kind: "program", title: p.name, href: `/admin/programs/${p.id}` });
    }
    const { siteId, checkoutUrl } = kajabiLinksOf(o.data);
    const kajabiUrl = siteId ? KAJABI_ADMIN_OFFER_URL.replace("{siteId}", siteId).replace("{offerId}", o.kajabi_offer_id) : null;
    return { offerId: o.kajabi_offer_id, name, status: o.status, kajabiUrl, checkoutUrl, resources };
  });
  const rank: Record<OfferCoverageState, number> = { multiple: 0, unmapped: 1, mapped: 2 };
  return rows.sort((a, b) => rank[coverageState(a)] - rank[coverageState(b)] || a.name.localeCompare(b.name));
}

type Repos = {
  billing: BillingRepository;
  events: EventRepository;
  courses: CourseRepository;
  kajabiCourses: KajabiCourseRepository;
  programs: ProgramRepository;
};

/** Reads every source of offer links and joins them to the offers. */
export async function loadOfferCoverage(repos: Repos): Promise<OfferCoverageRow[]> {
  const [offers, eventLinks, events, courses, programs] = await Promise.all([
    repos.billing.kajabiOfferRows(),
    repos.events.linkedOffers(),
    repos.events.listWithPhotoCounts(),
    repos.courses.courses({ source: "kajabi" }),
    repos.programs.listWithCounts(),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const courseBySourceKey = new Map(courses.filter((c) => c.source_key).map((c) => [c.source_key as string, c]));
  const offerRows = await repos.kajabiCourses.liveOffers([...courseBySourceKey.keys()]);

  return buildOfferCoverage({
    offers,
    eventLinks: eventLinks.flatMap((l) => {
      const event = eventById.get(l.event_id);
      return event ? [{ kajabi_offer_id: l.kajabi_offer_id, event: { slug: event.slug, title: event.title } }] : [];
    }),
    courseLinks: offerRows.flatMap((r) => {
      const course = courseBySourceKey.get(r.course_kajabi_id);
      return course ? [{ offerId: r.offer_kajabi_id, course: { id: course.id, title: course.title } }] : [];
    }),
    programs,
  });
}
