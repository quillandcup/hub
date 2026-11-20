import { EMPTY_LANDING_DATA, normalizeLandingData, type LandingData } from "@/lib/landing/data";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";
import { must } from "./query";

export type LandingPage = Row<"landing_pages">;
/** A page is public once published; a template is a page kept to start others from and is never public (docs/LANDING_PAGES.md, "Templates"). */
export type LandingPageKind = "page" | "template";
/** A page without its two JSON documents: what a list shows. */
export type LandingPageSummary = Omit<LandingPage, "draft_data" | "published_data">;
export type LandingPageVersion = Omit<Row<"landing_page_versions">, "data">;

/** What a signed-out visitor is given: the published document and the fields the page's head needs. */
export interface PublishedLandingPage {
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  socialImageAssetId: string | null;
  publishedAt: string | null;
  data: LandingData;
}

export interface LandingPageDetails {
  title: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  socialImageAssetId: string | null;
}

/** Thrown by `create` and `updateDetails` when another live page already has the address. */
export class LandingPageSlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The address "${slug}" is already used by another page.`);
    this.name = "LandingPageSlugTakenError";
  }
}

const UNIQUE_VIOLATION = "23505";
/** The columns an import sets on a new page; `updated_at` equals `imported_at` so a later edit is told from the import. */
const importStamp = (importKey: string) => {
  const now = new Date().toISOString();
  return { import_key: importKey, imported_at: now, updated_at: now };
};
const SUMMARY_COLUMNS =
  "id, slug, title, kind, status, seo_title, seo_description, social_image_asset_id, first_published_at, published_at, restored_from_version_id, restored_at, import_key, imported_at, starter_applied_at, created_by, updated_by, created_at, updated_at, deleted_at";
const VERSION_COLUMNS = "id, page_id, title, kind, published_by, created_at";

/**
 * Landing pages from the page builder (docs/LANDING_PAGES.md): a draft the editor autosaves, a published copy the
 * public route renders, and a version kept at each publish. Admin only under row-level security, so use the signed-in
 * admin's repositories for the editor. The one signed-out read, `published`, is for the public route and must run with
 * the service role (`getServiceRepos()`): it returns only a page that is published and not deleted.
 *
 * Methods throw `new Error(<database message>)` on a database error; a lookup that finds nothing returns null.
 */
export interface LandingPageRepository {
  /** Live pages of a kind (pages unless asked otherwise; "all" for both), most recently changed first. */
  list(kind?: LandingPageKind | "all"): Promise<LandingPageSummary[]>;
  /** The live page or template with this id, with its draft and published documents, or null. */
  byId(id: string): Promise<LandingPage | null>;
  /** Templates that can be used now: published and not deleted, by title. A template never published, or taken down, is not offered. */
  usableTemplates(): Promise<UsableTemplate[]>;
  /** A usable template's PUBLISHED document (never its draft), or null when it is gone, not a template, or not published. */
  usableTemplateData(id: string): Promise<{ title: string; data: LandingData } | null>;
  /** The live page or template with this address, with its draft and published documents, or null. For the editor; never for visitors. */
  bySlug(slug: string): Promise<LandingPage | null>;
  /** What the public page renders: the published PAGE with this address, or null for a draft, a deleted page, a template or no page. */
  published(slug: string): Promise<PublishedLandingPage | null>;
  /** The live page made by an import with this key (docs/LANDING_PAGES.md, "Importing from Kajabi"), or null. */
  byImportKey(importKey: string): Promise<LandingPage | null>;
  /** Makes a draft page (an empty document unless `data` is given). An `importKey` marks it as imported (one live page per key) and stamps `imported_at`. Throws `LandingPageSlugTakenError`. */
  create(input: { title: string; slug: string; data?: LandingData; createdBy: string | null; importKey?: string; kind?: LandingPageKind }): Promise<LandingPage>;
  /** Keeps the page's draft as it is now in its history, as a "before import" version (restorable like any version). Null when the page is gone. */
  keepDraftBeforeImport(id: string, updatedBy: string | null): Promise<LandingPageVersion | null>;
  /** An import again: replaces the draft document and stamps `imported_at` (one audit entry). Never touches the published copy, title, address or versions. Null when the page is gone. */
  replaceImportedDraft(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null>;
  /** Keeps the page's draft as it is now in its history, as a "before starter" version (restorable like any version). Null when the page is gone. */
  keepDraftBeforeStarter(id: string, updatedBy: string | null): Promise<LandingPageVersion | null>;
  /** "Replace with starter": replaces the draft document and stamps `starter_applied_at` (one audit entry). Never touches the published copy, title, address, SEO or versions. Null when the page is gone. */
  replaceDraftWithStarter(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null>;
  /** Autosave: replaces the draft document. Not audited. Returns the save time, or null when the page is gone. */
  saveDraft(id: string, data: LandingData, updatedBy: string | null): Promise<string | null>;
  /** Title, address and SEO. Audited. Null when the page is gone; throws `LandingPageSlugTakenError`. */
  updateDetails(id: string, details: LandingPageDetails, updatedBy: string | null): Promise<LandingPage | null>;
  /** Makes the draft the published page and keeps a version, in one step. Null when the page is gone. */
  publish(id: string): Promise<LandingPage | null>;
  /** Takes the page off the public site; the published copy and versions stay. Null when the page is gone. */
  unpublish(id: string, updatedBy: string | null): Promise<LandingPage | null>;
  /** The versions kept at publish, newest first (without their documents). */
  versions(pageId: string, limit?: number): Promise<LandingPageVersion[]>;
  /** One version's document, or null. */
  versionData(versionId: string): Promise<LandingData | null>;
  /** Puts a version's document into the draft (it does not publish). Null when the version or page is gone. */
  restoreVersion(versionId: string): Promise<LandingPage | null>;
  /** Throws the draft away: copies the published document back into it (it does not publish). Null when the page is gone or has never been published. */
  resetDraftToPublished(id: string, updatedBy: string | null): Promise<LandingPage | null>;
  /** Marks the page deleted (it frees its address). False when there was no live page. */
  remove(id: string, updatedBy: string | null): Promise<boolean>;
}

/** What a template offers when someone starts a page from it. */
export interface UsableTemplate {
  id: string;
  title: string;
  publishedAt: string | null;
}

const toUsable = (page: LandingPage): { title: string; data: LandingData } | null =>
  page.kind === "template" && page.status === "published" && !page.deleted_at && page.published_data ? { title: page.title, data: normalizeLandingData(page.published_data) } : null;

// Only a page of kind "page" is ever served to a visitor: a template's published copy is for starting pages, not for the public site.
const toPublished = (page: LandingPage): PublishedLandingPage | null =>
  page.kind === "page" && page.status === "published" && !page.deleted_at && page.published_data
    ? {
        slug: page.slug,
        title: page.title,
        seoTitle: page.seo_title,
        seoDescription: page.seo_description,
        socialImageAssetId: page.social_image_asset_id,
        publishedAt: page.published_at,
        data: normalizeLandingData(page.published_data),
      }
    : null;

export class SupabaseLandingPageRepository implements LandingPageRepository {
  constructor(private readonly db: Db) {}

  async list(kind: LandingPageKind | "all" = "page"): Promise<LandingPageSummary[]> {
    const query = this.db.from("landing_pages").select(SUMMARY_COLUMNS).is("deleted_at", null);
    return must(await (kind === "all" ? query : query.eq("kind", kind)).order("updated_at", { ascending: false }).order("id")) ?? [];
  }

  async byId(id: string): Promise<LandingPage | null> {
    return must(await this.db.from("landing_pages").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
  }

  async usableTemplates(): Promise<UsableTemplate[]> {
    const rows = must(await this.db.from("landing_pages").select("id, title, published_at").eq("kind", "template").eq("status", "published").is("deleted_at", null).order("title").order("id")) ?? [];
    return rows.map((r) => ({ id: r.id, title: r.title, publishedAt: r.published_at }));
  }

  async usableTemplateData(id: string): Promise<{ title: string; data: LandingData } | null> {
    const page = await this.byId(id);
    return page ? toUsable(page) : null;
  }

  async bySlug(slug: string): Promise<LandingPage | null> {
    return must(await this.db.from("landing_pages").select("*").eq("slug", slug).is("deleted_at", null).maybeSingle());
  }

  async published(slug: string): Promise<PublishedLandingPage | null> {
    const page = await this.bySlug(slug);
    return page ? toPublished(page) : null;
  }

  async byImportKey(importKey: string): Promise<LandingPage | null> {
    return must(await this.db.from("landing_pages").select("*").eq("import_key", importKey).is("deleted_at", null).maybeSingle());
  }

  async create(input: { title: string; slug: string; data?: LandingData; createdBy: string | null; importKey?: string; kind?: LandingPageKind }): Promise<LandingPage> {
    const { data, error } = await this.db
      .from("landing_pages")
      .insert({
        title: input.title,
        kind: input.kind ?? "page",
        slug: input.slug,
        draft_data: asJson(input.data ?? EMPTY_LANDING_DATA),
        ...(input.importKey ? importStamp(input.importKey) : {}),
        created_by: input.createdBy,
        updated_by: input.createdBy,
      })
      .select("*")
      .single();
    if (error?.code === UNIQUE_VIOLATION) throw new LandingPageSlugTakenError(input.slug);
    if (error) throw new Error(error.message);
    return data;
  }

  async keepDraftBeforeImport(id: string, updatedBy: string | null): Promise<LandingPageVersion | null> {
    const page = must(await this.db.from("landing_pages").select("title, draft_data").eq("id", id).is("deleted_at", null).maybeSingle());
    if (!page) return null;
    return must(await this.db.from("landing_page_versions").insert({ page_id: id, title: page.title, data: page.draft_data, kind: "before_import", published_by: updatedBy }).select(VERSION_COLUMNS).single());
  }

  async replaceImportedDraft(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null> {
    const now = new Date().toISOString();
    return must(
      await this.db.from("landing_pages").update({ draft_data: asJson(data), imported_at: now, updated_by: updatedBy, updated_at: now }).eq("id", id).is("deleted_at", null).select("*").maybeSingle(),
    );
  }

  async keepDraftBeforeStarter(id: string, updatedBy: string | null): Promise<LandingPageVersion | null> {
    const page = must(await this.db.from("landing_pages").select("title, draft_data").eq("id", id).is("deleted_at", null).maybeSingle());
    if (!page) return null;
    return must(await this.db.from("landing_page_versions").insert({ page_id: id, title: page.title, data: page.draft_data, kind: "before_starter", published_by: updatedBy }).select(VERSION_COLUMNS).single());
  }

  async replaceDraftWithStarter(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null> {
    const now = new Date().toISOString();
    return must(
      await this.db.from("landing_pages").update({ draft_data: asJson(data), starter_applied_at: now, updated_by: updatedBy, updated_at: now }).eq("id", id).is("deleted_at", null).select("*").maybeSingle(),
    );
  }

  async saveDraft(id: string, data: LandingData, updatedBy: string | null): Promise<string | null> {
    const updatedAt = new Date().toISOString();
    const rows = must(
      await this.db.from("landing_pages").update({ draft_data: asJson(data), updated_by: updatedBy, updated_at: updatedAt }).eq("id", id).is("deleted_at", null).select("id"),
    );
    return rows && rows.length > 0 ? updatedAt : null;
  }

  async updateDetails(id: string, details: LandingPageDetails, updatedBy: string | null): Promise<LandingPage | null> {
    const { data, error } = await this.db
      .from("landing_pages")
      .update({
        title: details.title,
        slug: details.slug,
        seo_title: details.seoTitle,
        seo_description: details.seoDescription,
        social_image_asset_id: details.socialImageAssetId,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error?.code === UNIQUE_VIOLATION) throw new LandingPageSlugTakenError(details.slug);
    if (error) throw new Error(error.message);
    return data;
  }

  async publish(id: string): Promise<LandingPage | null> {
    const { error } = await this.db.rpc("publish_landing_page", { p_page_id: id });
    if (error?.message === "not_found") return null;
    if (error) throw new Error(error.message);
    return must(await this.db.from("landing_pages").select("*").eq("id", id).maybeSingle());
  }

  async unpublish(id: string, updatedBy: string | null): Promise<LandingPage | null> {
    return must(
      await this.db
        .from("landing_pages")
        .update({ status: "draft", updated_by: updatedBy, updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle(),
    );
  }

  async versions(pageId: string, limit = 20): Promise<LandingPageVersion[]> {
    return must(await this.db.from("landing_page_versions").select(VERSION_COLUMNS).eq("page_id", pageId).order("created_at", { ascending: false }).order("id").limit(limit)) ?? [];
  }

  async versionData(versionId: string): Promise<LandingData | null> {
    const row = must(await this.db.from("landing_page_versions").select("data").eq("id", versionId).maybeSingle());
    return row ? normalizeLandingData(row.data) : null;
  }

  async restoreVersion(versionId: string): Promise<LandingPage | null> {
    const { error } = await this.db.rpc("restore_landing_page_version", { p_version_id: versionId });
    if (error?.message === "not_found") return null;
    if (error) throw new Error(error.message);
    const version = must(await this.db.from("landing_page_versions").select("page_id").eq("id", versionId).maybeSingle());
    if (!version) return null;
    return must(await this.db.from("landing_pages").select("*").eq("id", version.page_id).maybeSingle());
  }

  async resetDraftToPublished(id: string, updatedBy: string | null): Promise<LandingPage | null> {
    const page = must(await this.db.from("landing_pages").select("published_data").eq("id", id).is("deleted_at", null).maybeSingle());
    if (!page?.published_data) return null;
    return must(
      await this.db.from("landing_pages").update({ draft_data: page.published_data, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("*").maybeSingle(),
    );
  }

  async remove(id: string, updatedBy: string | null): Promise<boolean> {
    const now = new Date().toISOString();
    const rows = must(
      await this.db.from("landing_pages").update({ deleted_at: now, updated_by: updatedBy, updated_at: now }).eq("id", id).is("deleted_at", null).select("id"),
    );
    return Boolean(rows && rows.length > 0);
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** An id shaped like the database's `new_id(prefix)`: the prefix and 12 base58 characters. */
const newId = (prefix: string) => `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => BASE58[b % BASE58.length]).join("")}`;

export class InMemoryLandingPageRepository implements LandingPageRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live(): LandingPage[] {
    return this.data.landingPages.filter((p) => !p.deleted_at);
  }

  private summary(page: LandingPage): LandingPageSummary {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- leaving the two documents out is the point
    const { draft_data, published_data, ...rest } = page;
    return { ...rest };
  }

  async list(kind: LandingPageKind | "all" = "page"): Promise<LandingPageSummary[]> {
    return this.live()
      .filter((p) => kind === "all" || p.kind === kind)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1))
      .map((p) => this.summary(p));
  }

  async bySlug(slug: string): Promise<LandingPage | null> {
    const found = this.live().find((p) => p.slug === slug);
    return found ? structuredClone(found) : null;
  }

  async byId(id: string): Promise<LandingPage | null> {
    const found = this.find(id);
    return found ? structuredClone(found) : null;
  }

  async usableTemplates(): Promise<UsableTemplate[]> {
    return this.live()
      .filter((p) => p.kind === "template" && p.status === "published")
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : 1))
      .map((p) => ({ id: p.id, title: p.title, publishedAt: p.published_at }));
  }

  async usableTemplateData(id: string): Promise<{ title: string; data: LandingData } | null> {
    const found = this.find(id);
    return found ? toUsable(structuredClone(found)) : null;
  }

  async published(slug: string): Promise<PublishedLandingPage | null> {
    const page = await this.bySlug(slug);
    return page ? toPublished(page) : null;
  }

  async byImportKey(importKey: string): Promise<LandingPage | null> {
    const found = this.live().find((p) => p.import_key === importKey);
    return found ? structuredClone(found) : null;
  }

  async keepDraftBeforeImport(id: string, updatedBy: string | null): Promise<LandingPageVersion | null> {
    const page = this.find(id);
    if (!page) return null;
    const row = { id: newId("lpgv"), page_id: id, title: page.title, data: structuredClone(page.draft_data), kind: "before_import", published_by: updatedBy, created_at: new Date().toISOString() };
    this.data.landingPageVersions.push(row);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the document is left out of a version's summary
    const { data: _document, ...version } = row;
    return version;
  }

  async replaceImportedDraft(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page) return null;
    const now = new Date().toISOString();
    Object.assign(page, { draft_data: asJson(structuredClone(data)), imported_at: now, updated_by: updatedBy, updated_at: now });
    return structuredClone(page);
  }

  async keepDraftBeforeStarter(id: string, updatedBy: string | null): Promise<LandingPageVersion | null> {
    const page = this.find(id);
    if (!page) return null;
    const row = { id: newId("lpgv"), page_id: id, title: page.title, data: structuredClone(page.draft_data), kind: "before_starter", published_by: updatedBy, created_at: new Date().toISOString() };
    this.data.landingPageVersions.push(row);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the document is left out of a version's summary
    const { data: _document, ...version } = row;
    return version;
  }

  async replaceDraftWithStarter(id: string, data: LandingData, updatedBy: string | null): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page) return null;
    const now = new Date().toISOString();
    Object.assign(page, { draft_data: asJson(structuredClone(data)), starter_applied_at: now, updated_by: updatedBy, updated_at: now });
    return structuredClone(page);
  }

  async create(input: { title: string; slug: string; data?: LandingData; createdBy: string | null; importKey?: string; kind?: LandingPageKind }): Promise<LandingPage> {
    if (this.live().some((p) => p.slug === input.slug || (input.importKey && p.import_key === input.importKey))) throw new LandingPageSlugTakenError(input.slug);
    const now = new Date().toISOString();
    const page: LandingPage = {
      id: newId("lpg"),
      slug: input.slug,
      title: input.title,
      kind: input.kind ?? "page",
      status: "draft",
      draft_data: asJson(structuredClone(input.data ?? EMPTY_LANDING_DATA)),
      published_data: null,
      seo_title: null,
      seo_description: null,
      social_image_asset_id: null,
      first_published_at: null,
      published_at: null,
      restored_from_version_id: null,
      restored_at: null,
      import_key: input.importKey ?? null,
      imported_at: input.importKey ? now : null,
      starter_applied_at: null,
      created_by: input.createdBy,
      updated_by: input.createdBy,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    this.data.landingPages.push(page);
    return structuredClone(page);
  }

  private find(id: string): LandingPage | undefined {
    return this.live().find((p) => p.id === id);
  }

  async saveDraft(id: string, data: LandingData, updatedBy: string | null): Promise<string | null> {
    const page = this.find(id);
    if (!page) return null;
    page.draft_data = asJson(structuredClone(data));
    page.updated_by = updatedBy;
    page.updated_at = new Date().toISOString();
    return page.updated_at;
  }

  async updateDetails(id: string, details: LandingPageDetails, updatedBy: string | null): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page) return null;
    if (this.live().some((p) => p.id !== id && p.slug === details.slug)) throw new LandingPageSlugTakenError(details.slug);
    Object.assign(page, {
      title: details.title,
      slug: details.slug,
      seo_title: details.seoTitle,
      seo_description: details.seoDescription,
      social_image_asset_id: details.socialImageAssetId,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    });
    return structuredClone(page);
  }

  async publish(id: string): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page) return null;
    const now = new Date().toISOString();
    page.published_data = asJson(structuredClone(page.draft_data));
    page.status = "published";
    page.published_at = now;
    page.first_published_at = page.first_published_at ?? now;
    page.updated_at = now;
    this.data.landingPageVersions.push({ id: newId("lpgv"), page_id: id, title: page.title, data: structuredClone(page.draft_data), kind: "published", published_by: page.updated_by, created_at: now });
    return structuredClone(page);
  }

  async unpublish(id: string, updatedBy: string | null): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page) return null;
    Object.assign(page, { status: "draft", updated_by: updatedBy, updated_at: new Date().toISOString() });
    return structuredClone(page);
  }

  async versions(pageId: string, limit = 20): Promise<LandingPageVersion[]> {
    return this.data.landingPageVersions
      .filter((v) => v.page_id === pageId)
      .reverse() // newest first: versions are only ever appended
      .slice(0, limit)
      .map((v) => ({ id: v.id, page_id: v.page_id, title: v.title, kind: v.kind, published_by: v.published_by, created_at: v.created_at }));
  }

  async versionData(versionId: string): Promise<LandingData | null> {
    const version = this.data.landingPageVersions.find((v) => v.id === versionId);
    return version ? normalizeLandingData(structuredClone(version.data)) : null;
  }

  async restoreVersion(versionId: string): Promise<LandingPage | null> {
    const version = this.data.landingPageVersions.find((v) => v.id === versionId);
    const page = version ? this.find(version.page_id) : undefined;
    if (!version || !page) return null;
    const now = new Date().toISOString();
    page.draft_data = asJson(structuredClone(version.data));
    page.restored_from_version_id = version.id;
    page.restored_at = now;
    page.updated_at = now;
    return structuredClone(page);
  }

  async resetDraftToPublished(id: string, updatedBy: string | null): Promise<LandingPage | null> {
    const page = this.find(id);
    if (!page?.published_data) return null;
    Object.assign(page, { draft_data: asJson(structuredClone(page.published_data)), updated_by: updatedBy, updated_at: new Date().toISOString() });
    return structuredClone(page);
  }

  async remove(id: string, updatedBy: string | null): Promise<boolean> {
    const page = this.find(id);
    if (!page) return false;
    const now = new Date().toISOString();
    Object.assign(page, { deleted_at: now, updated_by: updatedBy, updated_at: now });
    return true;
  }
}
