import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * An event as the in-memory dataset keeps it. The badges only need `id`, `title` and `slug`; the rest
 * of the database's columns are optional so a test or seed names just the ones it cares about.
 */
export type EventRow = Pick<Row<"events">, "id" | "title" | "slug"> & Partial<Omit<Row<"events">, "id" | "title" | "slug">>;

/** An event as a picker lists it (badge forms link a retreat badge to one). */
export interface EventChoice {
  id: string;
  title: string;
  starts_at: string;
}

/**
 * Community events (retreats, workshops, speaker sessions): the `events` table and, as the methods
 * land, its attendees and photos. Every method throws on a database error.
 */
export interface EventRepository {
  /** Every event that has a start time, newest first, for a picker. Paginated. */
  choices(): Promise<EventChoice[]>;
}

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly db: Db) {}

  async choices(): Promise<EventChoice[]> {
    type Page = { data: EventChoice[] | null; error: { message: string } | null };
    return fetchAllRows<EventChoice>(
      (from, to) => this.db.from("events").select("id, title, starts_at").order("starts_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<Page>
    );
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryEventRepository implements EventRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async choices() {
    return this.data.events
      .flatMap((e) => (e.starts_at ? [{ id: e.id, title: e.title, starts_at: e.starts_at }] : []))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : a.starts_at > b.starts_at ? -1 : a.id < b.id ? -1 : 1));
  }
}
