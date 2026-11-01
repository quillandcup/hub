import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/** A feature flag's registry row (`feature_flags`). */
export type FeatureFlag = { featureKey: string; enabledGlobally: boolean };

/** A flag switched on for a segment (`feature_flag_segments`). */
export type FeatureFlagSegmentLink = { featureKey: string; segmentId: string };

/** A feature switched on for one signed-in user (`user_feature_previews`). */
export type FeaturePreview = { userId: string; featureKey: string };

/** Ids per `.in(...)` request, so the URL stays under PostgREST's length limit. */
const ID_CHUNK = 200;

/**
 * Feature flags: the global switch, the segments a flag is linked to, and the previews individual
 * users turned on for themselves (`feature_flags`, `feature_flag_segments`, `user_feature_previews`).
 * Who ends up with a flag is decided in `lib/features.server.ts` from these reads; the segment side
 * (who is in a segment) is `SegmentRepository`. Read on every page load, so every read is a small,
 * fixed number of queries.
 *
 * Methods throw `new Error(<database message>)` on a database error.
 */
export interface FeatureFlagRepository {
  /** Every flag with a registry row. */
  all(): Promise<FeatureFlag[]>;
  /** The keys switched on for everyone. */
  globallyEnabledKeys(): Promise<string[]>;
  /** Whether the flag is on for everyone; false for a key with no registry row. */
  isGloballyEnabled(key: string): Promise<boolean>;
  /** Switches the flag on or off for everyone, creating its registry row. */
  setGlobal(key: string, enabled: boolean): Promise<void>;
  /** The flag-to-segment links, for every flag or for one key. */
  segmentLinks(key?: string): Promise<FeatureFlagSegmentLink[]>;
  /** Links the flag to a segment (creating the flag's registry row, off, if it has none). Linking twice is fine. */
  linkSegment(key: string, segmentId: string): Promise<void>;
  /** Unlinks the flag from a segment; nothing happens if it was not linked. */
  unlinkSegment(key: string, segmentId: string): Promise<void>;
  /** The feature keys this user turned on for themselves. */
  previewKeys(userId: string): Promise<string[]>;
  /** Every user's previews, paginated past 1000. */
  allPreviews(): Promise<FeaturePreview[]>;
  /** Which of these users turned `key` on for themselves, chunked. */
  userIdsWithPreview(key: string, userIds: string[]): Promise<string[]>;
  /** Turns one feature on or off for the user. */
  setPreview(userId: string, key: string, enabled: boolean): Promise<void>;
  /** Makes the user's previews exactly these keys. */
  replacePreviews(userId: string, keys: string[]): Promise<void>;
}

export class SupabaseFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly db: Db) {}

  async all(): Promise<FeatureFlag[]> {
    const rows = await fetchAllRows<{ feature_key: string; enabled_globally: boolean }>((from, to) =>
      this.db.from("feature_flags").select("feature_key, enabled_globally").order("feature_key").range(from, to),
    );
    return rows.map((r) => ({ featureKey: r.feature_key, enabledGlobally: r.enabled_globally }));
  }

  async globallyEnabledKeys(): Promise<string[]> {
    const rows = must(await this.db.from("feature_flags").select("feature_key").eq("enabled_globally", true));
    return (rows ?? []).map((r) => r.feature_key);
  }

  async isGloballyEnabled(key: string): Promise<boolean> {
    const row = must(await this.db.from("feature_flags").select("enabled_globally").eq("feature_key", key).maybeSingle());
    return row?.enabled_globally === true;
  }

  async setGlobal(key: string, enabled: boolean): Promise<void> {
    must(await this.db.from("feature_flags").upsert({ feature_key: key, enabled_globally: enabled }, { onConflict: "feature_key" }));
  }

  async segmentLinks(key?: string): Promise<FeatureFlagSegmentLink[]> {
    const rows = await fetchAllRows<{ feature_key: string; segment_id: string }>((from, to) => {
      let query = this.db.from("feature_flag_segments").select("feature_key, segment_id");
      if (key !== undefined) query = query.eq("feature_key", key);
      return query.order("feature_key").order("segment_id").range(from, to);
    });
    return rows.map((r) => ({ featureKey: r.feature_key, segmentId: r.segment_id }));
  }

  async linkSegment(key: string, segmentId: string): Promise<void> {
    // The link's foreign key needs the flag's registry row, even for a key never toggled globally.
    must(await this.db.from("feature_flags").upsert({ feature_key: key }, { onConflict: "feature_key", ignoreDuplicates: true }));
    must(await this.db.from("feature_flag_segments").upsert({ feature_key: key, segment_id: segmentId }, { onConflict: "feature_key,segment_id" }));
  }

  async unlinkSegment(key: string, segmentId: string): Promise<void> {
    must(await this.db.from("feature_flag_segments").delete().eq("feature_key", key).eq("segment_id", segmentId));
  }

  async previewKeys(userId: string): Promise<string[]> {
    const rows = must(await this.db.from("user_feature_previews").select("feature_key").eq("user_id", userId));
    return (rows ?? []).map((r) => r.feature_key);
  }

  async allPreviews(): Promise<FeaturePreview[]> {
    const rows = await fetchAllRows<{ user_id: string; feature_key: string }>((from, to) =>
      this.db.from("user_feature_previews").select("user_id, feature_key").order("user_id").order("feature_key").range(from, to),
    );
    return rows.map((r) => ({ userId: r.user_id, featureKey: r.feature_key }));
  }

  async userIdsWithPreview(key: string, userIds: string[]): Promise<string[]> {
    const rows = await inChunks(userIds, ID_CHUNK, async (part) =>
      must(await this.db.from("user_feature_previews").select("user_id").eq("feature_key", key).in("user_id", part)) ?? [],
    );
    return rows.map((r) => r.user_id);
  }

  async setPreview(userId: string, key: string, enabled: boolean): Promise<void> {
    if (enabled) {
      must(await this.db.from("user_feature_previews").upsert({ user_id: userId, feature_key: key }, { onConflict: "user_id,feature_key" }));
    } else {
      must(await this.db.from("user_feature_previews").delete().eq("user_id", userId).eq("feature_key", key));
    }
  }

  async replacePreviews(userId: string, keys: string[]): Promise<void> {
    must(await this.db.from("user_feature_previews").delete().eq("user_id", userId));
    if (keys.length > 0) {
      must(await this.db.from("user_feature_previews").insert(keys.map((feature_key) => ({ user_id: userId, feature_key }))));
    }
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private ensureFlag(key: string) {
    let flag = this.data.featureFlags.find((f) => f.feature_key === key);
    if (!flag) {
      const now = new Date().toISOString();
      flag = { feature_key: key, enabled_globally: false, created_at: now, updated_at: now };
      this.data.featureFlags.push(flag);
    }
    return flag;
  }

  async all(): Promise<FeatureFlag[]> {
    return [...this.data.featureFlags]
      .sort((a, b) => (a.feature_key < b.feature_key ? -1 : 1))
      .map((f) => ({ featureKey: f.feature_key, enabledGlobally: f.enabled_globally }));
  }

  async globallyEnabledKeys(): Promise<string[]> {
    return this.data.featureFlags.filter((f) => f.enabled_globally).map((f) => f.feature_key);
  }

  async isGloballyEnabled(key: string): Promise<boolean> {
    return this.data.featureFlags.find((f) => f.feature_key === key)?.enabled_globally === true;
  }

  async setGlobal(key: string, enabled: boolean): Promise<void> {
    const flag = this.ensureFlag(key);
    flag.enabled_globally = enabled;
    flag.updated_at = new Date().toISOString();
  }

  async segmentLinks(key?: string): Promise<FeatureFlagSegmentLink[]> {
    return this.data.featureFlagSegments
      .filter((l) => key === undefined || l.feature_key === key)
      .map((l) => ({ featureKey: l.feature_key, segmentId: l.segment_id }));
  }

  async linkSegment(key: string, segmentId: string): Promise<void> {
    this.ensureFlag(key);
    if (!this.data.segments.some((s) => s.id === segmentId)) {
      throw new Error('insert or update on table "feature_flag_segments" violates foreign key constraint "feature_flag_segments_segment_id_fkey"');
    }
    if (!this.data.featureFlagSegments.some((l) => l.feature_key === key && l.segment_id === segmentId)) {
      this.data.featureFlagSegments.push({ feature_key: key, segment_id: segmentId, created_at: new Date().toISOString() });
    }
  }

  async unlinkSegment(key: string, segmentId: string): Promise<void> {
    this.data.featureFlagSegments = this.data.featureFlagSegments.filter((l) => !(l.feature_key === key && l.segment_id === segmentId));
  }

  async previewKeys(userId: string): Promise<string[]> {
    return this.data.userFeaturePreviews.filter((p) => p.user_id === userId).map((p) => p.feature_key);
  }

  async allPreviews(): Promise<FeaturePreview[]> {
    return this.data.userFeaturePreviews.map((p) => ({ userId: p.user_id, featureKey: p.feature_key }));
  }

  async userIdsWithPreview(key: string, userIds: string[]): Promise<string[]> {
    const wanted = new Set(userIds);
    return this.data.userFeaturePreviews.filter((p) => p.feature_key === key && wanted.has(p.user_id)).map((p) => p.user_id);
  }

  async setPreview(userId: string, key: string, enabled: boolean): Promise<void> {
    const others = this.data.userFeaturePreviews.filter((p) => !(p.user_id === userId && p.feature_key === key));
    this.data.userFeaturePreviews = enabled ? [...others, { user_id: userId, feature_key: key, enabled_at: new Date().toISOString() }] : others;
  }

  async replacePreviews(userId: string, keys: string[]): Promise<void> {
    this.data.userFeaturePreviews = this.data.userFeaturePreviews.filter((p) => p.user_id !== userId);
    for (const key of keys) this.data.userFeaturePreviews.push({ user_id: userId, feature_key: key, enabled_at: new Date().toISOString() });
  }
}
