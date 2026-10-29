import { randomInt } from "crypto";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

export type MediaAsset = Row<"media_assets">;
export type NewMediaAsset = Pick<Insert<"media_assets">, "storage_path" | "mime_type" | "width" | "height" | "bytes" | "sha256" | "title"> &
  Partial<Pick<Insert<"media_assets">, "alt_text" | "tags" | "owner_member_id" | "is_public" | "source" | "source_key" | "created_by">>;
export type MediaAssetEdit = Partial<Pick<MediaAsset, "title" | "alt_text" | "tags" | "focal_x" | "focal_y" | "fits" | "is_public">>;

/** Whose assets: the shared library, or one member's own. */
export type MediaScope = "shared" | { memberId: string };

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
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const newImgId = () => `img_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

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
      id: newImgId(),
      alt_text: null,
      owner_member_id: null,
      is_public: false,
      source: "upload",
      source_key: null,
      created_by: null,
      focal_x: null,
      focal_y: null,
      fits: {},
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
}
