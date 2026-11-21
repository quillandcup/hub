import { normalizeSiteTemplate, type SiteTemplate } from "@/lib/landing/site-template";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";
import { newId } from "./landing-pages";
import { must } from "./query";

export type LandingSiteTemplateRow = Row<"landing_site_template">;

/** One kept publish of the site design, without its document: who published it (a user id, never sent to the browser) and when. */
export type LandingSiteTemplateVersion = Omit<Row<"landing_site_template_versions">, "data">;

const VERSION_COLUMNS = "id, template_id, published_by, created_at";

/** The site template for the editor: the draft being worked on, the published copy (null before the first publish) and when. */
export interface LandingSiteTemplateState {
  draft: SiteTemplate;
  published: SiteTemplate | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * The header and footer every website page shares (docs/product/LANDING_PAGES.md, "Site template"): one row for the site, with a draft
 * the Design view autosaves (not audited) and a published copy the public website pages render. Admin only under row-level
 * security. The one signed-out read, `published`, is for the public route and must run with the service role
 * (`getServiceRepos()`); it returns the published copy only, never the draft.
 *
 * Methods throw `new Error(<database message>)` on a database error.
 */
export interface LandingSiteTemplateRepository {
  /** The draft and the published copy, for the editor. A site that was never edited has an empty draft. */
  state(): Promise<LandingSiteTemplateState>;
  /** What website pages render for visitors: the published copy, or null before the first publish. */
  published(): Promise<SiteTemplate | null>;
  /** Replaces the draft (autosave; nothing goes live). Creates the row on the first save. */
  saveDraft(data: SiteTemplate, updatedBy: string | null): Promise<void>;
  /** Makes the draft the published copy, for every website page at once, and keeps a version, in one step. False when there is no draft to publish. */
  publish(updatedBy: string | null): Promise<boolean>;
  /** Throws the draft away: copies the published copy back into it (one audit entry). False when nothing was ever published. */
  resetDraftToPublished(updatedBy: string | null): Promise<boolean>;
  /** The versions kept at publish, newest first (without their documents). */
  versions(limit?: number): Promise<LandingSiteTemplateVersion[]>;
  /** Puts a version's document into the draft (one audit entry). It does not publish. False when the version is gone. */
  restoreVersion(versionId: string, updatedBy: string | null): Promise<boolean>;
}

const toState = (row: LandingSiteTemplateRow | null): LandingSiteTemplateState => ({
  draft: normalizeSiteTemplate(row?.draft_data),
  published: row?.published_data ? normalizeSiteTemplate(row.published_data) : null,
  publishedAt: row?.published_at ?? null,
  updatedAt: row?.updated_at ?? null,
});

export class SupabaseLandingSiteTemplateRepository implements LandingSiteTemplateRepository {
  constructor(private readonly db: Db) {}

  private async row(): Promise<LandingSiteTemplateRow | null> {
    return must(await this.db.from("landing_site_template").select("*").limit(1).maybeSingle());
  }

  async state(): Promise<LandingSiteTemplateState> {
    return toState(await this.row());
  }

  async published(): Promise<SiteTemplate | null> {
    return toState(await this.row()).published;
  }

  async saveDraft(data: SiteTemplate, updatedBy: string | null): Promise<void> {
    // `singleton` is unique, so a concurrent first save is one row, not two.
    must(await this.db.from("landing_site_template").upsert({ singleton: true, draft_data: asJson(data), updated_by: updatedBy, updated_at: new Date().toISOString() }, { onConflict: "singleton" }));
  }

  async publish(updatedBy: string | null): Promise<boolean> {
    // The publish and its version are one database function, so a published copy never lacks its version. It stamps the signed-in admin.
    const { data, error } = await this.db.rpc("publish_landing_site_template");
    if (error) throw new Error(error.message);
    return data === true;
  }

  async resetDraftToPublished(updatedBy: string | null): Promise<boolean> {
    const row = await this.row();
    if (!row?.published_data) return false;
    const now = new Date().toISOString();
    must(await this.db.from("landing_site_template").update({ draft_data: row.published_data, draft_reset_at: now, updated_by: updatedBy, updated_at: now }).eq("id", row.id));
    return true;
  }

  async versions(limit = 20): Promise<LandingSiteTemplateVersion[]> {
    return must(await this.db.from("landing_site_template_versions").select(VERSION_COLUMNS).order("created_at", { ascending: false }).order("id").limit(limit)) ?? [];
  }

  async restoreVersion(versionId: string): Promise<boolean> {
    const { error } = await this.db.rpc("restore_landing_site_template_version", { p_version_id: versionId });
    if (error?.message === "not_found") return false;
    if (error) throw new Error(error.message);
    return true;
  }
}

export class InMemoryLandingSiteTemplateRepository implements LandingSiteTemplateRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private row(): LandingSiteTemplateRow | null {
    return this.data.landingSiteTemplates[0] ?? null;
  }

  async state(): Promise<LandingSiteTemplateState> {
    return toState(this.row());
  }

  async published(): Promise<SiteTemplate | null> {
    return toState(this.row()).published;
  }

  async saveDraft(data: SiteTemplate, updatedBy: string | null): Promise<void> {
    const now = new Date().toISOString();
    const row = this.row();
    if (row) Object.assign(row, { draft_data: asJson(structuredClone(data)), updated_by: updatedBy, updated_at: now });
    else this.data.landingSiteTemplates.push({ id: newId("lpst"), singleton: true, draft_data: asJson(structuredClone(data)), published_data: null, published_at: null, published_by: null, restored_from_version_id: null, restored_at: null, draft_reset_at: null, created_at: now, updated_at: now, updated_by: updatedBy });
  }

  async publish(updatedBy: string | null): Promise<boolean> {
    const row = this.row();
    if (!row) return false;
    const now = new Date().toISOString();
    Object.assign(row, { published_data: structuredClone(row.draft_data), published_at: now, published_by: updatedBy, updated_by: updatedBy, updated_at: now });
    this.data.landingSiteTemplateVersions.push({ id: newId("lpstv"), template_id: row.id, data: structuredClone(row.draft_data), published_by: updatedBy, created_at: now });
    return true;
  }

  async resetDraftToPublished(updatedBy: string | null): Promise<boolean> {
    const row = this.row();
    if (!row?.published_data) return false;
    const now = new Date().toISOString();
    Object.assign(row, { draft_data: structuredClone(row.published_data), draft_reset_at: now, updated_by: updatedBy, updated_at: now });
    return true;
  }

  async versions(limit = 20): Promise<LandingSiteTemplateVersion[]> {
    return this.data.landingSiteTemplateVersions
      .map((v, order) => ({ v, order }))
      .sort((a, b) => b.v.created_at.localeCompare(a.v.created_at) || b.order - a.order) // newest first; same-millisecond publishes keep their order
      .slice(0, limit)
      .map(({ v }) => ({ id: v.id, template_id: v.template_id, published_by: v.published_by, created_at: v.created_at }));
  }

  async restoreVersion(versionId: string, updatedBy: string | null): Promise<boolean> {
    const version = this.data.landingSiteTemplateVersions.find((v) => v.id === versionId);
    const row = version ? this.data.landingSiteTemplates.find((t) => t.id === version.template_id) : undefined;
    if (!version || !row) return false;
    const now = new Date().toISOString();
    Object.assign(row, { draft_data: structuredClone(version.data), restored_from_version_id: version.id, restored_at: now, updated_by: updatedBy, updated_at: now });
    return true;
  }
}
