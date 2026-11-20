import { normalizeLandingData, type LandingData } from "@/lib/landing/data";
import { templateNameKey, type TemplateVersionKind } from "@/lib/landing/templates";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";
import { must } from "./query";

export type LandingTemplate = Row<"landing_page_templates">;
/** A template without its document: what a list shows. `current_version` is the number of versions saved so far. */
export type LandingTemplateSummary = Omit<LandingTemplate, "data">;
export type LandingTemplateVersion = Omit<Row<"landing_page_template_versions">, "data">;
/** What a save leaves behind: the template and the number of the version just written. */
export interface SavedLandingTemplate {
  id: string;
  version: number;
}

/** Thrown by `save` and `updateDetails` when another live template already has the name (case aside). */
export class LandingTemplateNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`The name "${name}" is already used by another template.`);
    this.name = "LandingTemplateNameTakenError";
  }
}

const UNIQUE_VIOLATION = "23505";
const SUMMARY_COLUMNS = "id, name, description, current_version, last_save_kind, created_by, updated_by, created_at, updated_at, deleted_at";
const VERSION_COLUMNS = "id, template_id, version, name, description, note, kind, restored_from_version, created_by, created_at";

/**
 * Saved templates of the page builder (docs/LANDING_PAGES.md, "Templates"): a page document with a name, kept as numbered
 * versions. A template's current content is always its latest version: `save` and `restoreVersion` write both in one step
 * (a database function each, so row-level security applies), and a version is never rewritten. Admin only under
 * row-level security, so use the signed-in admin's repositories.
 *
 * Methods throw `new Error(<database message>)` on a database error; a lookup that finds nothing returns null.
 */
export interface LandingTemplateRepository {
  /** Live templates (not deleted), by name, without their documents. */
  list(): Promise<LandingTemplateSummary[]>;
  /** The live template with its current document, or null. */
  byId(id: string): Promise<LandingTemplate | null>;
  /**
   * A new template (no `templateId`) or the next version of an existing one (overwriting it; the old version is kept).
   * `note` says why it changed. Null when the template to overwrite is gone; throws `LandingTemplateNameTakenError`.
   */
  save(input: { name: string; description: string; data: LandingData; templateId?: string; note?: string | null; createdBy: string | null }): Promise<SavedLandingTemplate | null>;
  /** A template's versions, newest first (without their documents). */
  versions(templateId: string, limit?: number): Promise<LandingTemplateVersion[]>;
  /** One version's document, or null. */
  versionData(versionId: string): Promise<{ templateId: string; version: number; data: LandingData } | null>;
  /** Makes an earlier version the template's current content as a NEW version. Null when the version or template is gone. */
  restoreVersion(versionId: string, restoredBy: string | null): Promise<SavedLandingTemplate | null>;
  /** Renames or re-describes (no new version; audited). Null when the template is gone; throws `LandingTemplateNameTakenError`. */
  updateDetails(id: string, details: { name: string; description: string }, updatedBy: string | null): Promise<LandingTemplate | null>;
  /** Marks the template deleted (it frees its name); its versions stay. False when there was no live template. */
  remove(id: string, updatedBy: string | null): Promise<boolean>;
}

export class SupabaseLandingTemplateRepository implements LandingTemplateRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<LandingTemplateSummary[]> {
    // A handful of admin-made templates, never a table that grows with the community.
    return must(await this.db.from("landing_page_templates").select(SUMMARY_COLUMNS).is("deleted_at", null).order("name").order("id")) ?? [];
  }

  async byId(id: string): Promise<LandingTemplate | null> {
    return must(await this.db.from("landing_page_templates").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
  }

  async save(input: { name: string; description: string; data: LandingData; templateId?: string; note?: string | null; createdBy: string | null }): Promise<SavedLandingTemplate | null> {
    const { data, error } = await this.db.rpc("save_landing_page_template", {
      p_name: input.name,
      p_description: input.description,
      p_data: asJson(input.data),
      ...(input.templateId ? { p_template_id: input.templateId } : {}),
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error?.code === UNIQUE_VIOLATION) throw new LandingTemplateNameTakenError(input.name);
    if (error?.message === "not_found") return null;
    if (error) throw new Error(error.message);
    const saved = data?.[0];
    return saved ? { id: saved.saved_id, version: saved.saved_version } : null;
  }

  async versions(templateId: string, limit = 50): Promise<LandingTemplateVersion[]> {
    return must(await this.db.from("landing_page_template_versions").select(VERSION_COLUMNS).eq("template_id", templateId).order("version", { ascending: false }).limit(limit)) ?? [];
  }

  async versionData(versionId: string): Promise<{ templateId: string; version: number; data: LandingData } | null> {
    const row = must(await this.db.from("landing_page_template_versions").select("template_id, version, data").eq("id", versionId).maybeSingle());
    return row ? { templateId: row.template_id, version: row.version, data: normalizeLandingData(row.data) } : null;
  }

  async restoreVersion(versionId: string): Promise<SavedLandingTemplate | null> {
    const { data, error } = await this.db.rpc("restore_landing_page_template_version", { p_version_id: versionId });
    if (error?.message === "not_found") return null;
    if (error) throw new Error(error.message);
    const saved = data?.[0];
    return saved ? { id: saved.saved_id, version: saved.saved_version } : null;
  }

  async updateDetails(id: string, details: { name: string; description: string }, updatedBy: string | null): Promise<LandingTemplate | null> {
    const { data, error } = await this.db
      .from("landing_page_templates")
      .update({ name: details.name.trim(), description: details.description, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error?.code === UNIQUE_VIOLATION) throw new LandingTemplateNameTakenError(details.name);
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, updatedBy: string | null): Promise<boolean> {
    const now = new Date().toISOString();
    const rows = must(await this.db.from("landing_page_templates").update({ deleted_at: now, updated_by: updatedBy, updated_at: now }).eq("id", id).is("deleted_at", null).select("id"));
    return Boolean(rows && rows.length > 0);
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** An id shaped like the database's `new_id(prefix)`: the prefix and 12 base58 characters. */
const newId = (prefix: string) => `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => BASE58[b % BASE58.length]).join("")}`;

export class InMemoryLandingTemplateRepository implements LandingTemplateRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live(): LandingTemplate[] {
    return this.data.landingPageTemplates.filter((t) => !t.deleted_at);
  }

  private find(id: string): LandingTemplate | undefined {
    return this.live().find((t) => t.id === id);
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    return this.live().some((t) => t.id !== exceptId && templateNameKey(t.name) === templateNameKey(name));
  }

  private summary(template: LandingTemplate): LandingTemplateSummary {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- leaving the document out is the point
    const { data, ...rest } = template;
    return { ...rest };
  }

  private addVersion(template: LandingTemplate, kind: TemplateVersionKind, note: string | null, restoredFrom: number | null, by: string | null, at: string) {
    this.data.landingPageTemplateVersions.push({
      id: newId("lpgtv"),
      template_id: template.id,
      version: template.current_version,
      name: template.name,
      description: template.description,
      data: structuredClone(template.data),
      note,
      kind,
      restored_from_version: restoredFrom,
      created_by: by,
      created_at: at,
    });
  }

  async list(): Promise<LandingTemplateSummary[]> {
    return this.live()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
      .map((t) => this.summary(t));
  }

  async byId(id: string): Promise<LandingTemplate | null> {
    const found = this.find(id);
    return found ? structuredClone(found) : null;
  }

  async save(input: { name: string; description: string; data: LandingData; templateId?: string; note?: string | null; createdBy: string | null }): Promise<SavedLandingTemplate | null> {
    const name = input.name.trim();
    const note = input.note?.trim() || null;
    const now = new Date().toISOString();
    if (input.templateId) {
      const template = this.find(input.templateId);
      if (!template) return null;
      if (this.nameTaken(name, template.id)) throw new LandingTemplateNameTakenError(name);
      Object.assign(template, { name, description: input.description, data: asJson(structuredClone(input.data)), current_version: template.current_version + 1, last_save_kind: "overwritten", updated_by: input.createdBy, updated_at: now });
      this.addVersion(template, "overwritten", note, null, input.createdBy, now);
      return { id: template.id, version: template.current_version };
    }
    if (this.nameTaken(name)) throw new LandingTemplateNameTakenError(name);
    const template: LandingTemplate = {
      id: newId("lpgt"),
      name,
      description: input.description,
      data: asJson(structuredClone(input.data)),
      current_version: 1,
      last_save_kind: "created",
      created_by: input.createdBy,
      updated_by: input.createdBy,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    this.data.landingPageTemplates.push(template);
    this.addVersion(template, "created", note, null, input.createdBy, now);
    return { id: template.id, version: 1 };
  }

  async versions(templateId: string, limit = 50): Promise<LandingTemplateVersion[]> {
    return this.data.landingPageTemplateVersions
      .filter((v) => v.template_id === templateId)
      .sort((a, b) => b.version - a.version)
      .slice(0, limit)
      .map((v) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the document is left out of a version's summary
        const { data, ...rest } = v;
        return { ...rest };
      });
  }

  async versionData(versionId: string): Promise<{ templateId: string; version: number; data: LandingData } | null> {
    const version = this.data.landingPageTemplateVersions.find((v) => v.id === versionId);
    return version ? { templateId: version.template_id, version: version.version, data: normalizeLandingData(structuredClone(version.data)) } : null;
  }

  async restoreVersion(versionId: string, restoredBy: string | null): Promise<SavedLandingTemplate | null> {
    const version = this.data.landingPageTemplateVersions.find((v) => v.id === versionId);
    const template = version ? this.find(version.template_id) : undefined;
    if (!version || !template) return null;
    const now = new Date().toISOString();
    Object.assign(template, { description: version.description, data: asJson(structuredClone(version.data)), current_version: template.current_version + 1, last_save_kind: "restored", updated_by: restoredBy, updated_at: now });
    this.addVersion(template, "restored", null, version.version, restoredBy, now);
    return { id: template.id, version: template.current_version };
  }

  async updateDetails(id: string, details: { name: string; description: string }, updatedBy: string | null): Promise<LandingTemplate | null> {
    const template = this.find(id);
    if (!template) return null;
    const name = details.name.trim();
    if (this.nameTaken(name, id)) throw new LandingTemplateNameTakenError(name);
    Object.assign(template, { name, description: details.description, updated_by: updatedBy, updated_at: new Date().toISOString() });
    return structuredClone(template);
  }

  async remove(id: string, updatedBy: string | null): Promise<boolean> {
    const template = this.find(id);
    if (!template) return false;
    const now = new Date().toISOString();
    Object.assign(template, { deleted_at: now, updated_by: updatedBy, updated_at: now });
    return true;
  }
}
