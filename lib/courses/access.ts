import { resolveMatchDate } from "@/lib/kajabi-cohort-matching";

/**
 * Who can open which course (docs/COURSES.md, `course_access`). Pure.
 *
 * Derived from active Kajabi purchases of a course's offers (a refunded or cancelled purchase,
 * `deactivated_at` set, grants nothing) plus staff-written grants. `starts_at` is the purchase
 * date (the same coalesced date cohort matching uses), or the course's launch if that's later
 * (pre-orders); `ends_at` is `starts_at` plus the course's access duration, or null for lifetime.
 * A member with several ways in keeps the one that lasts longest, so buying again after access
 * ended gives access again.
 */

export interface AccessRow {
  member_id: string;
  course_id: string;
  starts_at: string;
  ends_at: string | null;
  origin: "purchase" | "grant";
}

export interface PurchaseIn {
  kajabi_customer_id: string | null;
  kajabi_offer_id: string;
  created_at_kajabi: string | null;
  effective_start_at: string | null;
  deactivated_at: string | null;
}

export interface GrantIn {
  member_id: string;
  course_id: string;
  starts_at: string;
  ends_at: string | null;
}

export interface CourseAccessInput {
  /** Silver course id, its Kajabi offer ids, and the access duration as Postgres prints an interval. */
  courses: {
    id: string;
    offerIds: Set<string>;
    accessDuration: string | null;
    /** Access starts no earlier than this (pre-orders); null or absent = at purchase. */
    launchAt?: string | null;
  }[];
  purchases: PurchaseIn[];
  /** Customer id -> canonical (alias-resolved) email. */
  emailByCustomerId: Map<string, string>;
  /** Canonical email -> member id. */
  memberIdByEmail: Map<string, string>;
  grants: GrantIn[];
}

const UNITS: Record<string, (d: Date, n: number) => void> = {
  year: (d, n) => d.setUTCFullYear(d.getUTCFullYear() + n),
  mon: (d, n) => d.setUTCMonth(d.getUTCMonth() + n),
  day: (d, n) => d.setUTCDate(d.getUTCDate() + n),
};

/**
 * `start` plus an interval in years, months and days: ISO 8601 as PostgREST serialises it
 * ("P1Y", "P6M", "P30D", "P1Y6M"), or Postgres's own text ("1 year", "6 mons", "30 days").
 * Throws on anything else (hours, weeks...) rather than guessing a wrong end date.
 */
export function addInterval(start: string, interval: string): string {
  const date = new Date(start);
  const iso = interval.trim().match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/);
  if (iso && interval.trim() !== "P") {
    const [, y, m, d] = iso;
    if (y) UNITS.year(date, Number(y));
    if (m) UNITS.mon(date, Number(m));
    if (d) UNITS.day(date, Number(d));
    return date.toISOString();
  }
  const parts = interval.trim().split(/\s+/);
  if (parts.length === 0 || parts.length % 2 !== 0) throw new Error(`Unsupported access duration: "${interval}"`);
  for (let i = 0; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const unit = parts[i + 1].replace(/s$/, "");
    if (!Number.isInteger(n) || !UNITS[unit]) throw new Error(`Unsupported access duration: "${interval}"`);
    UNITS[unit](date, n);
  }
  return date.toISOString();
}

/** Which of two accesses lasts longer; null (lifetime) beats any date. */
function lastsLonger(a: { ends_at: string | null }, b: { ends_at: string | null }): boolean {
  if (a.ends_at === null) return b.ends_at !== null;
  if (b.ends_at === null) return false;
  return new Date(a.ends_at).getTime() > new Date(b.ends_at).getTime();
}

export function computeCourseAccess(input: CourseAccessInput): AccessRow[] {
  const best = new Map<string, AccessRow>(); // key: member_id|course_id

  const consider = (row: AccessRow) => {
    const key = `${row.member_id}|${row.course_id}`;
    const current = best.get(key);
    if (!current || lastsLonger(row, current)) best.set(key, row);
  };

  for (const course of input.courses) {
    for (const p of input.purchases) {
      if (p.deactivated_at || !course.offerIds.has(p.kajabi_offer_id) || !p.kajabi_customer_id) continue;
      const email = input.emailByCustomerId.get(p.kajabi_customer_id);
      const memberId = email ? input.memberIdByEmail.get(email) : undefined;
      const startsAt = resolveMatchDate(p);
      if (!memberId || !startsAt) continue;
      // Early buyers' access (and its length) runs from launch, not from when they pre-ordered.
      const purchased = new Date(startsAt);
      const launch = course.launchAt ? new Date(course.launchAt) : null;
      const start = (launch && launch.getTime() > purchased.getTime() ? launch : purchased).toISOString();
      consider({
        member_id: memberId,
        course_id: course.id,
        starts_at: start,
        ends_at: course.accessDuration ? addInterval(start, course.accessDuration) : null,
        origin: "purchase",
      });
    }
  }

  const courseIds = new Set(input.courses.map((c) => c.id));
  for (const g of input.grants) {
    if (!courseIds.has(g.course_id)) continue;
    consider({
      member_id: g.member_id,
      course_id: g.course_id,
      starts_at: new Date(g.starts_at).toISOString(),
      ends_at: g.ends_at ? new Date(g.ends_at).toISOString() : null,
      origin: "grant",
    });
  }

  return Array.from(best.values());
}
