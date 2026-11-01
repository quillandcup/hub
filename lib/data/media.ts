import { randomInt } from "crypto";
import type { Db, Insert, Row } from "./db";
import { eventDetails } from "./events";
import type { InMemoryDataset } from "./in-memory";

export type MediaAsset = Row<"media_assets">;
export type NewMediaAsset = Pick<Insert<"media_assets">, "storage_path" | "mime_type" | "width" | "height" | "bytes" | "sha256" | "title"> &
  Partial<Pick<Insert<"media_assets">, "kind" | "alt_text" | "tags" | "owner_member_id" | "is_public" | "source" | "source_key" | "created_by">>;
export type MediaAssetEdit = Partial<Pick<MediaAsset, "title" | "alt_text" | "tags" | "focal_x" | "focal_y" | "fits" | "is_public">>;

/** Whose assets: the shared library, or one member's own. */
export type MediaScope = "shared" | { memberId: string };

/** A place an asset is used: a deleted asset can't be one that something still shows. */
export interface MediaUsage {
  kind: "event" | "book" | "project" | "course" | "module" | "lesson";
  id: string;
  /** What to call it. A writing project is private to its owner, so it is never named. */
  title: string;
  /** An event's address (admin and member pages use it, not the id); only events have one. */
  slug?: string;
}

export interface MediaSearch {
  scope: MediaScope;
  /** Matches a title (any part) or a tag (the whole tag), ignoring case. */
  q?: string;
  /** Only assets carrying this tag. */
  tag?: string;
  /** Page size (default 48, at most 200) and offset. Newest first. */
  limit?: number;
  offset?: number;
}

/** Tags are kept lowercase, trimmed, without blanks or repeats. */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** A search term reduced to letters, digits, spaces and dashes, so it can't carry filter syntax or wildcards. */
function searchTerm(q: string | undefined): string {
  return (q ?? "").toLowerCase().replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim();
}

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 200;
const clampLimit = (limit?: number) => Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));

/**
 * The media library (docs/MEDIA_LIBRARY.md): uploaded images and what is known about them. Reads leave out
 * deleted assets (staff can still read them through `byId`, as RLS allows) and throw on a database error.
 * Which assets a caller can see at all is RLS: pass a user client for the caller's view, the service role
 * for the server's.
 */
export interface MediaRepository {
  /** One asset (a deleted one included, if the caller may see it), or null. */
  byId(id: string): Promise<MediaAsset | null>;
  /** The live asset with these bytes in this owner's library (null owner = the shared one), or null. */
  bySha(sha256: string, ownerMemberId: string | null): Promise<MediaAsset | null>;
  /** The live asset imported from this source, or null. */
  bySource(source: string, sourceKey: string): Promise<MediaAsset | null>;
  /** A page of live assets, newest first. */
  search(query: MediaSearch): Promise<MediaAsset[]>;
  /** Adds an asset. Throws when the owner already has live bytes with that hash (use `bySha` first). */
  add(asset: NewMediaAsset): Promise<MediaAsset>;
  /** Changes these fields; null when there is no live asset with that id. */
  edit(id: string, fields: MediaAssetEdit): Promise<MediaAsset | null>;
  /** Marks the asset deleted; false when there was no live asset. */
  remove(id: string): Promise<boolean>;
  /** Assets deleted before this instant whose files haven't been removed yet, oldest first (for the nightly sweep). */
  expiredDeleted(before: Date, limit: number): Promise<MediaAsset[]>;
  /** Records that this asset's files are gone, so the sweep leaves the row alone from now on. */
  markFilesRemoved(id: string): Promise<void>;
  /** Everything that shows this asset: events, books (as a cover), writing projects, and a course's, module's or lesson's image. Each feature that gets an `*_asset_id` column adds itself. What the caller can't read (another member's project) isn't listed. */
  usages(id: string): Promise<MediaUsage[]>;
}

export class SupabaseMediaRepository implements MediaRepository {
  constructor(private readonly db: Db) {}

  private get table() {
    return this.db.from("media_assets");
  }

  async byId(id: string) {
    const { data, error } = await this.table.select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async bySha(sha256: string, ownerMemberId: string | null) {
    let query = this.table.select("*").eq("sha256", sha256).is("deleted_at", null);
    query = ownerMemberId === null ? query.is("owner_member_id", null) : query.eq("owner_member_id", ownerMemberId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async bySource(source: string, sourceKey: string) {
    const { data, error } = await this.table.select("*").eq("source", source).eq("source_key", sourceKey).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async search({ scope, q, tag, limit, offset = 0 }: MediaSearch) {
    let query = this.table.select("*").is("deleted_at", null);
    query = scope === "shared" ? query.is("owner_member_id", null) : query.eq("owner_member_id", scope.memberId);
    const term = searchTerm(q);
    if (term) query = query.or(`title.ilike.%${term}%,tags.cs.{${term.replace(/ /g, "-")}}`);
    const wanted = normalizeTags(tag ? [tag] : [])[0];
    if (wanted) query = query.contains("tags", [wanted]);
    const size = clampLimit(limit);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(offset, offset + size - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async add(asset: NewMediaAsset) {
    const { data, error } = await this.table.insert({ ...asset, tags: normalizeTags(asset.tags ?? []) }).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async edit(id: string, fields: MediaAssetEdit) {
    const patch = { ...fields, ...(fields.tags ? { tags: normalizeTags(fields.tags) } : {}) };
    const { data, error } = await this.table.update(patch).eq("id", id).is("deleted_at", null).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string) {
    const { data, error } = await this.table.update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async expiredDeleted(before: Date, limit: number) {
    const { data, error } = await this.table
      .select("*")
      .not("deleted_at", "is", null)
      .lt("deleted_at", before.toISOString())
      .is("files_removed_at", null)
      .order("deleted_at", { ascending: true })
      .order("id")
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async markFilesRemoved(id: string) {
    const { error } = await this.table.update({ files_removed_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async usages(id: string) {
    const [events, books, projects, courses, modules, lessons] = await Promise.all([
      this.db.from("community_event_details").select("id, title, slug").eq("image_id", id).order("starts_at", { ascending: false }).order("id"),
      this.db.from("member_books").select("id, title").eq("cover_asset_id", id).order("published_date", { ascending: false }).order("id"),
      this.db.from("writing_projects").select("id").eq("cover_asset_id", id).order("id"),
      this.db.from("courses").select("id, title").or(`thumbnail_asset_id.eq.${id},hero_asset_id.eq.${id}`).order("id"),
      this.db.from("course_modules").select("id, title").eq("poster_asset_id", id).order("id"),
      this.db.from("course_lessons").select("id, title").eq("thumbnail_asset_id", id).order("id"),
    ]);
    for (const result of [events, books, projects, courses, modules, lessons]) if (result.error) throw new Error(result.error.message);
    return [
      ...(events.data ?? []).map((e) => ({ kind: "event" as const, id: e.id as string, title: e.title as string, slug: e.slug as string })),
      ...(books.data ?? []).map((b) => ({ kind: "book" as const, id: b.id, title: b.title })),
      ...(projects.data ?? []).map((p) => ({ kind: "project" as const, id: p.id, title: "A writing project" })),
      ...(courses.data ?? []).map((c) => ({ kind: "course" as const, id: c.id, title: c.title })),
      ...(modules.data ?? []).map((m) => ({ kind: "module" as const, id: m.id, title: m.title })),
      ...(lessons.data ?? []).map((l) => ({ kind: "lesson" as const, id: l.id, title: l.title })),
    ];
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const newMediaId = () => `media_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

/** In-memory twin over an `InMemoryDataset`. Like the table, it refuses a second live copy of the same bytes for one owner and of the same import source. */
export class InMemoryMediaRepository implements MediaRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.mediaAssets.filter((a) => a.deleted_at === null);
  }

  async byId(id: string) {
    return this.data.mediaAssets.find((a) => a.id === id) ?? null;
  }

  async bySha(sha256: string, ownerMemberId: string | null) {
    return this.live().find((a) => a.sha256 === sha256 && a.owner_member_id === ownerMemberId) ?? null;
  }

  async bySource(source: string, sourceKey: string) {
    return this.live().find((a) => a.source === source && a.source_key === sourceKey) ?? null;
  }

  async search({ scope, q, tag, limit, offset = 0 }: MediaSearch) {
    const term = searchTerm(q);
    const wanted = normalizeTags(tag ? [tag] : [])[0];
    return this.live()
      .filter((a) => (scope === "shared" ? a.owner_member_id === null : a.owner_member_id === scope.memberId))
      .filter((a) => !term || a.title.toLowerCase().includes(term) || a.tags.includes(term.replace(/ /g, "-")))
      .filter((a) => !wanted || a.tags.includes(wanted))
      .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? 1 : -1))
      .slice(offset, offset + clampLimit(limit))
      .map((a) => ({ ...a }));
  }

  async add(asset: NewMediaAsset) {
    if (await this.bySha(asset.sha256, asset.owner_member_id ?? null)) throw new Error("duplicate key value violates unique constraint \"media_assets_owner_sha256_key\"");
    if (asset.source_key && (await this.bySource(asset.source ?? "upload", asset.source_key))) throw new Error("duplicate key value violates unique constraint \"media_assets_source_key\"");
    if (this.data.mediaAssets.some((a) => a.storage_path === asset.storage_path)) throw new Error("duplicate key value violates unique constraint \"media_assets_storage_path_key\"");
    const now = new Date().toISOString();
    const row: MediaAsset = {
      id: newMediaId(),
      kind: "image",
      alt_text: null,
      owner_member_id: null,
      is_public: false,
      source: "upload",
      source_key: null,
      created_by: null,
      focal_x: null,
      focal_y: null,
      fits: {},
      files_removed_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      ...asset,
      tags: normalizeTags(asset.tags ?? []),
    };
    this.data.mediaAssets.push(row);
    return { ...row };
  }

  async edit(id: string, fields: MediaAssetEdit) {
    const row = this.live().find((a) => a.id === id);
    if (!row) return null;
    Object.assign(row, fields, fields.tags ? { tags: normalizeTags(fields.tags) } : {}, { updated_at: new Date().toISOString() });
    return { ...row };
  }

  async remove(id: string) {
    const row = this.live().find((a) => a.id === id);
    if (!row) return false;
    row.deleted_at = new Date().toISOString();
    return true;
  }

  async expiredDeleted(before: Date, limit: number) {
    return this.data.mediaAssets
      .filter((a) => a.deleted_at !== null && a.deleted_at < before.toISOString() && a.files_removed_at === null)
      .sort((a, b) => ((a.deleted_at as string) === (b.deleted_at as string) ? (a.id < b.id ? -1 : 1) : (a.deleted_at as string) < (b.deleted_at as string) ? -1 : 1))
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  async markFilesRemoved(id: string) {
    const row = this.data.mediaAssets.find((a) => a.id === id);
    if (row) row.files_removed_at = new Date().toISOString();
  }

  async usages(id: string) {
    const events = eventDetails(this.data)
      .filter((e) => e.image_id === id)
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : a.starts_at > b.starts_at ? -1 : a.id < b.id ? -1 : 1))
      .map((e) => ({ kind: "event" as const, id: e.id, title: e.title, slug: e.slug }));
    const books = this.data.memberBooks
      .filter((b) => b.cover_asset_id === id)
      .sort((a, b) => (a.published_date < b.published_date ? 1 : a.published_date > b.published_date ? -1 : a.id < b.id ? -1 : 1))
      .map((b) => ({ kind: "book" as const, id: b.id, title: b.title }));
    const projects = this.data.writingProjects
      .filter((p) => p.cover_asset_id === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((p) => ({ kind: "project" as const, id: p.id, title: "A writing project" }));
    const courseImages = this.data.courseImages
      .filter((c) => c.asset_ids.includes(id))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((c) => ({ kind: c.kind, id: c.id, title: c.title }));
    const order = { course: 0, module: 1, lesson: 2 } as const;
    return [...events, ...books, ...projects, ...courseImages.sort((a, b) => order[a.kind] - order[b.kind])];
  }
}
