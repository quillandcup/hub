import { SupabaseLandingPageRepository } from "@/lib/data/landing-pages";
import { clock } from "@/lib/clock";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { withTimeout } from "@/lib/with-timeout";

/**
 * Which landing page addresses are published, for the proxy (src/proxy.ts, resolveLandingRoute in src/lib/root-routing.ts), which has
 * to know on the root host whether `/<slug>` is a page or an old Kajabi address, before any page renders.
 *
 * One read of every published address (a few dozen at most; `publishedAddresses` pages past 1000 rows), kept in this instance's
 * memory for FRESH_MS, so the cost is one small query per instance per half minute however many Kajabi-bound requests arrive, and
 * a spray of made-up addresses cannot reach the database at all. The price: a page published or taken down shows on the site up
 * to FRESH_MS later on an instance that already holds the list (the page itself is always read live, so what it shows is never stale).
 * Never throws and never waits long: when the read fails or is slow the last list is kept (or none, which means "no page here":
 * the old Kajabi redirect), and the next try is only RETRY_MS later, so a database outage costs a bounded wait at most once per
 * RETRY_MS, never the Kajabi redirects themselves.
 */
export const FRESH_MS = 30_000;
export const RETRY_MS = 5_000;
export const READ_TIMEOUT_MS = 1_500;

type Listing = { slugs: Set<string>; validUntil: number };

let listing: Listing | null = null;
let reading: Promise<Listing> | null = null;

async function read(readSlugs: () => Promise<string[]>): Promise<Listing> {
  const now = clock.now();
  try {
    const slugs = await withTimeout(readSlugs(), READ_TIMEOUT_MS);
    return { slugs: new Set(slugs), validUntil: now + FRESH_MS };
  } catch {
    return { slugs: listing?.slugs ?? new Set(), validUntil: now + RETRY_MS };
  }
}

const readFromDatabase = async () => (await new SupabaseLandingPageRepository(createServiceRoleClient()).publishedAddresses()).map((a) => a.slug);

/** True when a page with this address is published (never a draft, a deleted page or a template). `readSlugs` is for tests. */
export async function isPublishedAddress(slug: string, readSlugs: () => Promise<string[]> = readFromDatabase): Promise<boolean> {
  if (!listing || clock.now() >= listing.validUntil) {
    reading ??= read(readSlugs).finally(() => {
      reading = null;
    });
    listing = await reading;
  }
  return listing.slugs.has(slug);
}

/** Forgets the list, so the next question reads again (tests). */
export function forgetPublishedAddresses(): void {
  listing = null;
  reading = null;
}
