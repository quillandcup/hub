import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { ProspectAssessment } from "@/lib/prospecting/assessment";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";

const INSERT_CHUNK = 200;

export const PROSPECT_PLATFORMS = ["instagram", "bluesky"] as const;
export type ProspectPlatform = (typeof PROSPECT_PLATFORMS)[number];

/** Identifies a prospect across platforms: the same handle can exist on two. */
export const prospectKey = (platform: ProspectPlatform, handle: string) => `${platform}:${handle}`;

/** Where to see the account on its own platform. */
export const prospectProfileUrl = (platform: ProspectPlatform, handle: string) =>
  platform === "bluesky" ? `https://bsky.app/profile/${handle}` : `https://www.instagram.com/${handle}/`;

export const PROSPECT_STATUSES = ["new", "shortlisted", "rejected", "contacted"] as const;
/** Tier 2 id (never in a URL or link), checked where an action receives one from our own client. */
export const isProspectId = (value: string) => /^prsp_[1-9A-HJ-NP-Za-km-z]{12}$/.test(value);

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** An Instagram account that might be an ideal Hedgie, with the rules' score and where review stands. */
export type Prospect = {
  id: string;
  platform: ProspectPlatform;
  handle: string;
  source: string;
  sourceNote: string | null;
  bio: string | null;
  followerCount: number | null;
  hashtags: string[];
  externalUrl: string | null;
  fitScore: number;
  fitReasons: string[];
  status: ProspectStatus;
  rejectReason: string | null;
  assessment: ProspectAssessment | null;
  reviewedAt: string | null;
  createdAt: string;
};

/** What a source hands over, already scored. */
export type NewProspect = {
  platform: ProspectPlatform;
  handle: string;
  source: string;
  sourceNote?: string | null;
  bio: string | null;
  followerCount: number | null;
  hashtags: string[];
  externalUrl: string | null;
  fitScore: number;
  fitReasons: string[];
};

/**
 * Prospects (admin only). Methods throw on a database error. Handles are unique: adding one that is
 * already there changes nothing, so a source can be run again without duplicating or overwriting a
 * reviewed prospect.
 */
export interface ProspectRepository {
  /** Adds the prospects whose platform and handle are new; returns which (as `prospectKey`s) were added and which already existed. */
  addMany(prospects: NewProspect[], createdBy: string | null): Promise<{ added: string[]; existing: string[] }>;
  /** Everyone (optionally one status), best fit first, then by handle. */
  list(options?: { status?: ProspectStatus }): Promise<Prospect[]>;
  /** Records a review decision; `rejectReason` is kept only for "rejected". */
  review(id: string, status: ProspectStatus, reviewerId: string | null, rejectReason?: string | null): Promise<void>;
  /** Re-scores prospects after the rules changed. */
  rescore(updates: { id: string; fitScore: number; fitReasons: string[] }[]): Promise<void>;
  /** Prospects not yet assessed that are still open (new or shortlisted), best fit first. */
  awaitingAssessment(limit: number): Promise<Prospect[]>;
  saveAssessment(id: string, assessment: ProspectAssessment, at: Date): Promise<void>;
}

type ProspectRow = Row<"outreach_prospects">;

const toAssessment = (value: unknown): ProspectAssessment | null =>
  value && typeof value === "object" && "fit" in value && "summary" in value ? (value as ProspectAssessment) : null;

const toProspect = (row: ProspectRow): Prospect => ({
  id: row.id,
  platform: row.platform as ProspectPlatform,
  handle: row.handle,
  source: row.source,
  sourceNote: row.source_note,
  bio: row.bio,
  followerCount: row.follower_count,
  hashtags: row.hashtags,
  externalUrl: row.external_url,
  fitScore: row.fit_score,
  fitReasons: row.fit_reasons,
  status: row.status as ProspectStatus,
  rejectReason: row.reject_reason,
  assessment: toAssessment(row.ai_assessment),
  reviewedAt: row.reviewed_at,
  createdAt: row.created_at,
});

const bestFirst = (a: Prospect, b: Prospect) => b.fitScore - a.fitScore || a.handle.localeCompare(b.handle);

export class SupabaseProspectRepository implements ProspectRepository {
  constructor(private readonly db: Db) {}

  async addMany(prospects: NewProspect[], createdBy: string | null) {
    const added: string[] = [];
    for (const batch of chunk(prospects, INSERT_CHUNK)) {
      const { data, error } = await this.db
        .from("outreach_prospects")
        .upsert(
          batch.map((p) => ({
            platform: p.platform,
            handle: p.handle,
            source: p.source,
            source_note: p.sourceNote ?? null,
            bio: p.bio,
            follower_count: p.followerCount,
            hashtags: p.hashtags,
            external_url: p.externalUrl,
            fit_score: p.fitScore,
            fit_reasons: p.fitReasons,
            created_by: createdBy,
          })),
          { onConflict: "platform,handle", ignoreDuplicates: true },
        )
        .select("platform, handle");
      if (error) throw new Error(`Adding prospects failed: ${error.message}`);
      added.push(...(data ?? []).map((r) => prospectKey(r.platform as ProspectPlatform, r.handle)));
    }
    const addedSet = new Set(added);
    return { added, existing: prospects.map((p) => prospectKey(p.platform, p.handle)).filter((k) => !addedSet.has(k)) };
  }

  async list(options: { status?: ProspectStatus } = {}) {
    const rows = await fetchAllRows<ProspectRow>(
      (from, to) => {
        let query = this.db.from("outreach_prospects").select("*").order("id");
        if (options.status) query = query.eq("status", options.status);
        return query.range(from, to) as unknown as PromiseLike<{ data: ProspectRow[] | null; error: { message: string } | null }>;
      },
    );
    return rows.map(toProspect).sort(bestFirst);
  }

  async review(id: string, status: ProspectStatus, reviewerId: string | null, rejectReason?: string | null) {
    const { error } = await this.db
      .from("outreach_prospects")
      .update({ status, reject_reason: status === "rejected" ? (rejectReason ?? null) : null, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Reviewing prospect failed: ${error.message}`);
  }

  async rescore(updates: { id: string; fitScore: number; fitReasons: string[] }[]) {
    for (const batch of chunk(updates, 50)) {
      const results = await Promise.all(
        batch.map((u) => this.db.from("outreach_prospects").update({ fit_score: u.fitScore, fit_reasons: u.fitReasons, scored_at: new Date().toISOString() }).eq("id", u.id)),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`Re-scoring prospects failed: ${failed.error.message}`);
    }
  }

  async awaitingAssessment(limit: number) {
    const { data, error } = await this.db
      .from("outreach_prospects")
      .select("*")
      .is("ai_assessed_at", null)
      .in("status", ["new", "shortlisted"])
      .order("fit_score", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw new Error(`Listing prospects to assess failed: ${error.message}`);
    return (data ?? []).map(toProspect);
  }

  async saveAssessment(id: string, assessment: ProspectAssessment, at: Date) {
    const { error } = await this.db.from("outreach_prospects").update({ ai_assessment: asJson(assessment), ai_assessed_at: at.toISOString() }).eq("id", id);
    if (error) throw new Error(`Saving the assessment failed: ${error.message}`);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryProspectRepository implements ProspectRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async addMany(prospects: NewProspect[], _createdBy: string | null) {
    const added: string[] = [];
    const existing: string[] = [];
    for (const p of prospects) {
      const key = prospectKey(p.platform, p.handle);
      if (this.data.prospects.some((row) => prospectKey(row.platform, row.handle) === key)) {
        existing.push(key);
        continue;
      }
      this.data.prospects.push({
        id: newProspectId(),
        platform: p.platform,
        handle: p.handle,
        source: p.source,
        sourceNote: p.sourceNote ?? null,
        bio: p.bio,
        followerCount: p.followerCount,
        hashtags: p.hashtags,
        externalUrl: p.externalUrl,
        fitScore: p.fitScore,
        fitReasons: p.fitReasons,
        status: "new",
        rejectReason: null,
        assessment: null,
        assessedAt: null,
        reviewedAt: null,
        createdAt: new Date().toISOString(),
      });
      added.push(key);
    }
    return { added, existing };
  }

  async list(options: { status?: ProspectStatus } = {}) {
    return this.data.prospects
      .filter((p) => !options.status || p.status === options.status)
      .map(({ assessedAt: _assessedAt, ...p }) => ({ ...p }))
      .sort(bestFirst);
  }

  async review(id: string, status: ProspectStatus, _reviewerId: string | null, rejectReason?: string | null) {
    const row = this.data.prospects.find((p) => p.id === id);
    if (!row) return;
    row.status = status;
    row.rejectReason = status === "rejected" ? (rejectReason ?? null) : null;
    row.reviewedAt = new Date().toISOString();
  }

  async rescore(updates: { id: string; fitScore: number; fitReasons: string[] }[]) {
    for (const u of updates) {
      const row = this.data.prospects.find((p) => p.id === u.id);
      if (row) Object.assign(row, { fitScore: u.fitScore, fitReasons: u.fitReasons });
    }
  }

  async awaitingAssessment(limit: number) {
    return this.data.prospects
      .filter((p) => p.assessedAt === null && (p.status === "new" || p.status === "shortlisted"))
      .map(({ assessedAt: _assessedAt, ...p }) => ({ ...p }))
      .sort(bestFirst)
      .slice(0, limit);
  }

  async saveAssessment(id: string, assessment: ProspectAssessment, at: Date) {
    const row = this.data.prospects.find((p) => p.id === id);
    if (row) Object.assign(row, { assessment, assessedAt: at.toISOString() });
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const newProspectId = () => `prsp_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => BASE58[b % BASE58.length]).join("")}`;

/** A prospect as the in-memory dataset stores it. */
export type ProspectSeed = Prospect & { assessedAt: string | null };
