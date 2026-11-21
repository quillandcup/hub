import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/** A named group of members, which feature flags and bulk invites can target (`segments`). */
export type Segment = Row<"segments">;

export type SegmentWithCount = Segment & { memberCount: number };

/** Ids per `.in(...)` request, so the URL stays under PostgREST's length limit. */
const ID_CHUNK = 200;
/** Rows per insert, so one statement stays under the API role's statement timeout. */
const INSERT_CHUNK = 500;

/**
 * Segments and who is in them (`segments`, `segment_members`). Admin-written; feature flags read
 * them to decide who has a flag on. Deleting a segment removes its members and flag links (cascade).
 *
 * Methods throw `new Error(<database message>)` on a database error. A lookup that finds no row
 * returns null and the caller picks the message.
 */
export interface SegmentRepository {
  /** Every segment, newest first, each with its member count (member links are paginated past 1000). */
  list(): Promise<SegmentWithCount[]>;
  /** One segment, or null. */
  byId(id: string): Promise<Segment | null>;
  /** Makes a segment; `createdBy` is the Supabase Auth user, null for the service role. */
  create(name: string, createdBy: string | null): Promise<Segment>;
  /** Deletes the segment (its member and flag links cascade). */
  remove(id: string): Promise<void>;
  /** The members in a segment, in a stable order (the database's order by id), paginated past 1000. */
  memberIds(segmentId: string): Promise<string[]>;
  /** Adds members to a segment, in chunks. The caller drops the ones already in it (a repeat fails on the primary key). */
  addMembers(segmentId: string, memberIds: string[]): Promise<void>;
  /** Takes one member out of a segment; nothing happens if they were not in it. */
  removeMember(segmentId: string, memberId: string): Promise<void>;
  /** The segments this member is in. */
  segmentIdsForMember(memberId: string): Promise<string[]>;
  /** Which of `memberIds` are in any of `segmentIds`, chunked by member. */
  memberIdsInSegments(segmentIds: string[], memberIds: string[]): Promise<string[]>;
}

const SEGMENT_COLUMNS = "id, name, created_at, created_by";

export class SupabaseSegmentRepository implements SegmentRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<SegmentWithCount[]> {
    const [segments, links] = await Promise.all([
      this.db.from("segments").select(SEGMENT_COLUMNS).order("created_at", { ascending: false }).order("id").then(must),
      fetchAllRows<{ segment_id: string }>((from, to) =>
        this.db.from("segment_members").select("segment_id").order("segment_id").order("member_id").range(from, to),
      ),
    ]);
    const counts = new Map<string, number>();
    for (const link of links) counts.set(link.segment_id, (counts.get(link.segment_id) ?? 0) + 1);
    return (segments ?? []).map((s) => ({ ...s, memberCount: counts.get(s.id) ?? 0 }));
  }

  async byId(id: string): Promise<Segment | null> {
    return must(await this.db.from("segments").select(SEGMENT_COLUMNS).eq("id", id).maybeSingle());
  }

  async create(name: string, createdBy: string | null): Promise<Segment> {
    return must(await this.db.from("segments").insert({ name, created_by: createdBy }).select(SEGMENT_COLUMNS).single())!;
  }

  async remove(id: string): Promise<void> {
    must(await this.db.from("segments").delete().eq("id", id));
  }

  async memberIds(segmentId: string): Promise<string[]> {
    const rows = await fetchAllRows<{ member_id: string }>((from, to) =>
      this.db.from("segment_members").select("member_id").eq("segment_id", segmentId).order("member_id").range(from, to),
    );
    return rows.map((r) => r.member_id);
  }

  async addMembers(segmentId: string, memberIds: string[]): Promise<void> {
    for (let i = 0; i < memberIds.length; i += INSERT_CHUNK) {
      const batch = memberIds.slice(i, i + INSERT_CHUNK).map((member_id) => ({ segment_id: segmentId, member_id }));
      must(await this.db.from("segment_members").insert(batch));
    }
  }

  async removeMember(segmentId: string, memberId: string): Promise<void> {
    must(await this.db.from("segment_members").delete().eq("segment_id", segmentId).eq("member_id", memberId));
  }

  async segmentIdsForMember(memberId: string): Promise<string[]> {
    const rows = must(await this.db.from("segment_members").select("segment_id").eq("member_id", memberId));
    return (rows ?? []).map((r) => r.segment_id);
  }

  async memberIdsInSegments(segmentIds: string[], memberIds: string[]): Promise<string[]> {
    if (segmentIds.length === 0) return [];
    const found = await inChunks(memberIds, ID_CHUNK, async (part) =>
      must(await this.db.from("segment_members").select("member_id").in("segment_id", segmentIds).in("member_id", part)) ?? [],
    );
    return [...new Set(found.map((r) => r.member_id))];
  }
}

export class InMemorySegmentRepository implements SegmentRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async list(): Promise<SegmentWithCount[]> {
    return [...this.data.segments]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1))
      .map((s) => ({ ...s, memberCount: this.data.segmentMembers.filter((m) => m.segment_id === s.id).length }));
  }

  async byId(id: string): Promise<Segment | null> {
    const found = this.data.segments.find((s) => s.id === id);
    return found ? { ...found } : null;
  }

  async create(name: string, createdBy: string | null): Promise<Segment> {
    const segment: Segment = { id: `seg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, name, created_by: createdBy, created_at: new Date().toISOString() };
    this.data.segments.push(segment);
    return { ...segment };
  }

  async remove(id: string): Promise<void> {
    this.data.segments = this.data.segments.filter((s) => s.id !== id);
    this.data.segmentMembers = this.data.segmentMembers.filter((m) => m.segment_id !== id);
    this.data.featureFlagSegments = this.data.featureFlagSegments.filter((l) => l.segment_id !== id);
  }

  async memberIds(segmentId: string): Promise<string[]> {
    return this.data.segmentMembers
      .filter((m) => m.segment_id === segmentId)
      .map((m) => m.member_id)
      .sort();
  }

  async addMembers(segmentId: string, memberIds: string[]): Promise<void> {
    for (const memberId of memberIds) {
      if (this.data.segmentMembers.some((m) => m.segment_id === segmentId && m.member_id === memberId)) {
        throw new Error('duplicate key value violates unique constraint "segment_members_pkey"');
      }
      this.data.segmentMembers.push({ segment_id: segmentId, member_id: memberId, added_at: new Date().toISOString() });
    }
  }

  async removeMember(segmentId: string, memberId: string): Promise<void> {
    this.data.segmentMembers = this.data.segmentMembers.filter((m) => !(m.segment_id === segmentId && m.member_id === memberId));
  }

  async segmentIdsForMember(memberId: string): Promise<string[]> {
    return this.data.segmentMembers.filter((m) => m.member_id === memberId).map((m) => m.segment_id);
  }

  async memberIdsInSegments(segmentIds: string[], memberIds: string[]): Promise<string[]> {
    const wanted = new Set(memberIds);
    return [...new Set(this.data.segmentMembers.filter((m) => segmentIds.includes(m.segment_id) && wanted.has(m.member_id)).map((m) => m.member_id))];
  }
}
