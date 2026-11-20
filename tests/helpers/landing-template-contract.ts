import { describe, it, expect, beforeEach } from "vitest";
import { LandingTemplateNameTakenError, type LandingTemplateRepository } from "@/lib/data/landing-templates";
import { normalizeLandingData, type LandingData } from "@/lib/landing/data";

export type LandingTemplateContractContext = {
  repo: () => LandingTemplateRepository;
  /** A name no other test or run uses. */
  unique: (label: string) => string;
};

const doc = (text: string): LandingData => ({ content: [{ type: "Heading", props: { id: "h1", text } }], root: { props: {} } });
const headline = (data: unknown) => ((data as LandingData).content[0] as { props: { text: string } } | undefined)?.props.text;

/** Behavior every `LandingTemplateRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineLandingTemplateContract(name: string, setup: () => LandingTemplateContractContext) {
  describe(`${name} (LandingTemplateRepository contract)`, () => {
    let ctx: LandingTemplateContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("saves a new template as version 1 and finds it with its document", async () => {
      const label = ctx.unique("first");
      const saved = await ctx.repo().save({ name: label, description: "A start", data: doc("one"), createdBy: null });

      expect(saved).toEqual({ id: expect.stringMatching(/^lpgt_/), version: 1 });
      const template = await ctx.repo().byId(saved!.id);
      expect(template).toMatchObject({ name: label, description: "A start", current_version: 1, deleted_at: null });
      expect(headline(template?.data)).toBe("one");
      expect(await ctx.repo().byId(`lpgt_${"A".repeat(12)}`)).toBeNull();
      const [version] = await ctx.repo().versions(saved!.id);
      expect(version).toMatchObject({ id: expect.stringMatching(/^lpgtv_/), version: 1, kind: "created", name: label, note: null, restored_from_version: null });
    });

    it("lists live templates by name without their documents", async () => {
      const b = ctx.unique("b-list");
      const a = ctx.unique("a-list");
      await ctx.repo().save({ name: b, description: "", data: doc("b"), createdBy: null });
      await ctx.repo().save({ name: a, description: "", data: doc("a"), createdBy: null });

      const listed = (await ctx.repo().list()).filter((t) => t.name === a || t.name === b);

      expect(listed.map((t) => t.name)).toEqual([a, b]);
      expect(listed[0]).not.toHaveProperty("data");
      expect(listed[0].current_version).toBe(1);
    });

    it("overwrites as the next version, keeps the old one and records the note", async () => {
      const label = ctx.unique("over");
      const first = await ctx.repo().save({ name: label, description: "old", data: doc("one"), createdBy: null });

      const second = await ctx.repo().save({ name: label, description: "new", data: doc("two"), templateId: first!.id, note: "  A better headline  ", createdBy: null });

      expect(second).toEqual({ id: first!.id, version: 2 });
      const template = await ctx.repo().byId(first!.id);
      expect(template).toMatchObject({ current_version: 2, description: "new" });
      expect(headline(template?.data)).toBe("two");
      const versions = await ctx.repo().versions(first!.id);
      expect(versions.map((v) => [v.version, v.kind, v.note])).toEqual([
        [2, "overwritten", "A better headline"],
        [1, "created", null],
      ]);
      const old = await ctx.repo().versionData(versions[1].id);
      expect(old).toMatchObject({ templateId: first!.id, version: 1 });
      expect(headline(old?.data)).toBe("one");
      expect((await ctx.repo().list()).find((t) => t.id === first!.id)?.current_version).toBe(2);
    });

    it("refuses a name another live template has, whatever its case, and leaves no version behind", async () => {
      const label = ctx.unique("clash");
      const first = await ctx.repo().save({ name: label, description: "", data: doc("one"), createdBy: null });
      const other = await ctx.repo().save({ name: ctx.unique("other"), description: "", data: doc("other"), createdBy: null });

      await expect(ctx.repo().save({ name: ` ${label.toUpperCase()} `, description: "", data: doc("two"), createdBy: null })).rejects.toBeInstanceOf(LandingTemplateNameTakenError);
      await expect(ctx.repo().save({ name: label, description: "", data: doc("two"), templateId: other!.id, createdBy: null })).rejects.toBeInstanceOf(LandingTemplateNameTakenError);
      await expect(ctx.repo().updateDetails(other!.id, { name: label, description: "" }, null)).rejects.toBeInstanceOf(LandingTemplateNameTakenError);

      expect((await ctx.repo().versions(other!.id)).map((v) => v.version)).toEqual([1]);
      expect((await ctx.repo().byId(other!.id))?.current_version).toBe(1);
      expect((await ctx.repo().versions(first!.id)).length).toBe(1);
    });

    it("returns null when the template to overwrite is gone", async () => {
      expect(await ctx.repo().save({ name: ctx.unique("ghost"), description: "", data: doc("x"), templateId: `lpgt_${"B".repeat(12)}`, createdBy: null })).toBeNull();
    });

    it("brings an earlier version back as a new version and never rewrites history", async () => {
      const label = ctx.unique("restore");
      const first = await ctx.repo().save({ name: label, description: "first words", data: doc("one"), createdBy: null });
      await ctx.repo().save({ name: label, description: "second words", data: doc("two"), templateId: first!.id, createdBy: null });
      const [, v1] = await ctx.repo().versions(first!.id);

      const restored = await ctx.repo().restoreVersion(v1.id, null);

      expect(restored).toEqual({ id: first!.id, version: 3 });
      const template = await ctx.repo().byId(first!.id);
      expect(headline(template?.data)).toBe("one");
      expect(template).toMatchObject({ current_version: 3, name: label, description: "first words" });
      const versions = await ctx.repo().versions(first!.id);
      expect(versions.map((v) => [v.version, v.kind, v.restored_from_version])).toEqual([
        [3, "restored", 1],
        [2, "overwritten", null],
        [1, "created", null],
      ]);
      expect(headline((await ctx.repo().versionData(versions[1].id))?.data)).toBe("two");
      expect(await ctx.repo().restoreVersion(`lpgtv_${"C".repeat(12)}`, null)).toBeNull();
    });

    it("keeps the current name when an earlier version is brought back after a rename", async () => {
      const label = ctx.unique("renamed");
      const renamed = ctx.unique("renamed-later");
      const first = await ctx.repo().save({ name: label, description: "", data: doc("one"), createdBy: null });
      await ctx.repo().updateDetails(first!.id, { name: renamed, description: "" }, null);
      const [v1] = await ctx.repo().versions(first!.id);

      await ctx.repo().restoreVersion(v1.id, null);

      expect((await ctx.repo().byId(first!.id))?.name).toBe(renamed);
      expect((await ctx.repo().versions(first!.id))[0]).toMatchObject({ version: 2, name: renamed });
    });

    it("renames and re-describes without making a version", async () => {
      const first = await ctx.repo().save({ name: ctx.unique("rename"), description: "", data: doc("one"), createdBy: null });
      const label = ctx.unique("renamed");

      const renamed = await ctx.repo().updateDetails(first!.id, { name: ` ${label} `, description: "Now described" }, null);

      expect(renamed).toMatchObject({ name: label, description: "Now described", current_version: 1 });
      expect((await ctx.repo().versions(first!.id)).length).toBe(1);
      expect(await ctx.repo().updateDetails(`lpgt_${"D".repeat(12)}`, { name: ctx.unique("none"), description: "" }, null)).toBeNull();
    });

    it("deletes softly: the template leaves lists and frees its name, its versions stay", async () => {
      const label = ctx.unique("delete");
      const first = await ctx.repo().save({ name: label, description: "", data: doc("one"), createdBy: null });
      const [version] = await ctx.repo().versions(first!.id);

      expect(await ctx.repo().remove(first!.id, null)).toBe(true);
      expect(await ctx.repo().remove(first!.id, null)).toBe(false);

      expect(await ctx.repo().byId(first!.id)).toBeNull();
      expect((await ctx.repo().list()).some((t) => t.id === first!.id)).toBe(false);
      expect((await ctx.repo().versions(first!.id)).length).toBe(1);
      expect(headline((await ctx.repo().versionData(version.id))?.data)).toBe("one");
      expect(await ctx.repo().save({ name: label, description: "", data: doc("again"), templateId: first!.id, createdBy: null })).toBeNull();
      expect(await ctx.repo().restoreVersion(version.id, null)).toBeNull();
      const again = await ctx.repo().save({ name: label, description: "", data: doc("again"), createdBy: null });
      expect(again?.id).not.toBe(first!.id);
    });

    it("reads a stored document through the migrations, like a page does", async () => {
      const first = await ctx.repo().save({ name: ctx.unique("migrated"), description: "", data: doc("one"), createdBy: null });
      const [version] = await ctx.repo().versions(first!.id);

      expect((await ctx.repo().versionData(version.id))?.data).toEqual(normalizeLandingData(doc("one")));
    });
  });
}
