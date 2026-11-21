import { normalizeSiteTemplate, type SiteTemplate } from "@/lib/landing/site-template";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";
import { newId } from "./landing-pages";
import { must } from "./query";

export type LandingSiteTemplateRow = Row<"landing_site_template">;

/** The site template for the editor: the draft being worked on, the published copy (null before the first publish) and when. */
export interface LandingSiteTemplateState {
  draft: SiteTemplate;
  published: SiteTemplate | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * The header and footer every website page shares (docs/LANDING_PAGES.md, "Site template"): one row for the site, with a draft
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
  /** Makes the draft the published copy, for every website page at once. False when there is no draft to publish. */
  publish(updatedBy: string | null): Promise<boolean>;
  /** Throws the draft away: copies the published copy back into it. False when nothing was ever published. */
  resetDraftToPublished(updatedBy: string | null): Promise<boolean>;
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
    const row = await this.row();
    if (!row) return false;
    const now = new Date().toISOString();
    must(await this.db.from("landing_site_template").update({ published_data: row.draft_data, published_at: now, published_by: updatedBy, updated_by: updatedBy, updated_at: now }).eq("id", row.id));
    return true;
  }

  async resetDraftToPublished(updatedBy: string | null): Promise<boolean> {
    const row = await this.row();
    if (!row?.published_data) return false;
    must(await this.db.from("landing_site_template").update({ draft_data: row.published_data, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq("id", row.id));
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
    else this.data.landingSiteTemplates.push({ id: newId("lpst"), singleton: true, draft_data: asJson(structuredClone(data)), published_data: null, published_at: null, published_by: null, created_at: now, updated_at: now, updated_by: updatedBy });
  }

  async publish(updatedBy: string | null): Promise<boolean> {
    const row = this.row();
    if (!row) return false;
    const now = new Date().toISOString();
    Object.assign(row, { published_data: structuredClone(row.draft_data), published_at: now, published_by: updatedBy, updated_by: updatedBy, updated_at: now });
    return true;
  }

  async resetDraftToPublished(updatedBy: string | null): Promise<boolean> {
    const row = this.row();
    if (!row?.published_data) return false;
    Object.assign(row, { draft_data: structuredClone(row.published_data), updated_by: updatedBy, updated_at: new Date().toISOString() });
    return true;
  }
}
