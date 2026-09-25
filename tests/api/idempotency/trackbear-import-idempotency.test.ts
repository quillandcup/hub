import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { runTrackbearImport, type CoverCopier } from "@/lib/trackbear-import-runner";
import { trackbearExternalId, type TrackbearData } from "@/lib/trackbear-import";
import { makeTrackbearData } from "../../fixtures/trackbear/data";

/**
 * TrackBear import must be idempotent: members re-upload newer exports while they transition,
 * and a run that times out partway is finished by re-uploading the same file. Pattern: each
 * imported row carries external_id = "trackbear:<uuid>", unique per member.
 */
describe("TrackBear import idempotency", () => {
  const supabase = getTestSupabaseAdminClient();
  const ts = Date.now();
  let memberId: string;
  const coverCalls: string[] = [];
  const fakeCoverCopier: CoverCopier = async (filename) => {
    coverCalls.push(filename);
    return { url: `https://example.test/covers/${filename}.jpg`, resizedFrom: "600×900" };
  };

  async function countRows(table: string) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("member_id", memberId);
    if (error) throw new Error(error.message);
    return count;
  }

  beforeAll(async () => {
    const { data, error } = await supabase
      .from("members")
      .insert({
        name: "TrackBear Import Test",
        email: `trackbear-import-${ts}@example.com`,
        joined_at: new Date().toISOString(),
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    memberId = data.id;
  });

  afterAll(async () => {
    // Every writing_* row cascades from the member.
    if (memberId) await supabase.from("members").delete().eq("id", memberId);
  });

  it("first import creates projects, balances, entries, goals, and covers", async () => {
    const result = await runTrackbearImport(supabase, memberId, makeTrackbearData(), fakeCoverCopier);

    expect(result.created).toEqual({ projects: 2, entries: 4, goals: 2, startingBalances: 2, covers: 1 });
    expect(result.alreadyImported).toEqual({ projects: 0, entries: 0, goals: 0 });
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "changed", detail: expect.stringMatching(/resized from 600×900/) }));

    const { data: project } = await supabase
      .from("writing_projects")
      .select("id, title, description, phase, show_on_profile, cover_url, created_at")
      .eq("member_id", memberId)
      .eq("external_id", trackbearExternalId("11111111-1111-4111-8111-111111111111"))
      .single();
    expect(project).toMatchObject({
      title: "The Hedgehog's Journey",
      description: "A cozy fantasy.",
      phase: "on_hold",
      show_on_profile: true,
      cover_url: "https://example.test/covers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp.jpg",
    });
    expect(new Date(project!.created_at).toISOString()).toBe("2025-01-02T10:00:00.000Z");

    const { data: balances } = await supabase
      .from("writing_project_starting_balances")
      .select("measure, amount")
      .eq("project_id", project!.id)
      .order("measure");
    expect(balances).toEqual([
      { measure: "time_minutes", amount: 90 },
      { measure: "words", amount: 12000 },
    ]);

    const { data: entries } = await supabase
      .from("writing_progress_entries")
      .select("entry_date, measure, mode, amount, note, tags")
      .eq("project_id", project!.id)
      .order("entry_date");
    expect(entries).toEqual([
      { entry_date: "2025-01-05", measure: "words", mode: "delta", amount: 1500, note: "Great session", tags: ["drafting", "sprint"] },
      { entry_date: "2025-01-06", measure: "time_minutes", mode: "delta", amount: 45, note: null, tags: [] },
      { entry_date: "2025-01-07", measure: "words", mode: "delta", amount: -200, note: "cut a scene", tags: [] },
    ]);

    const { data: goals } = await supabase
      .from("writing_goals")
      .select("goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, project_id")
      .eq("member_id", memberId)
      .order("goal_type", { ascending: false });
    expect(goals).toEqual([
      { goal_type: "target", measure: "words", target_amount: 80000, start_date: "2025-01-01", end_date: "2025-06-30", habit_period: null, habit_threshold: null, is_starred: true, project_id: project!.id },
      { goal_type: "habit", measure: "time_minutes", target_amount: null, start_date: null, end_date: null, habit_period: "day", habit_threshold: 30, is_starred: false, project_id: project!.id },
    ]);
  });

  it("re-importing the same export creates nothing", async () => {
    coverCalls.length = 0;
    const result = await runTrackbearImport(supabase, memberId, makeTrackbearData(), fakeCoverCopier);

    expect(result.created).toEqual({ projects: 0, entries: 0, goals: 0, startingBalances: 0, covers: 0 });
    expect(result.alreadyImported).toEqual({ projects: 2, entries: 4, goals: 2 });
    expect(coverCalls).toEqual([]);
    expect(await countRows("writing_projects")).toBe(2);
    expect(await countRows("writing_progress_entries")).toBe(4);
    expect(await countRows("writing_goals")).toBe(2);
    expect(await countRows("writing_project_starting_balances")).toBe(2);
  });

  it("a newer export adds only new progress, onto the already-imported project, without overwriting Hub edits", async () => {
    await supabase
      .from("writing_projects")
      .update({ title: "Renamed in Hub" })
      .eq("member_id", memberId)
      .eq("external_id", trackbearExternalId("11111111-1111-4111-8111-111111111111"));

    const data = makeTrackbearData();
    data.projects[0].title = "Renamed in TrackBear";
    data.tallies.push({ ...data.tallies[0], id: 99, uuid: "99999999-9999-4999-8999-999999999999", date: "2025-02-01", count: 700 });

    const result = await runTrackbearImport(supabase, memberId, data, fakeCoverCopier);
    expect(result.created).toMatchObject({ projects: 0, entries: 1, goals: 0 });

    const { data: project } = await supabase
      .from("writing_projects")
      .select("id, title")
      .eq("member_id", memberId)
      .eq("external_id", trackbearExternalId("11111111-1111-4111-8111-111111111111"))
      .single();
    expect(project!.title).toBe("Renamed in Hub");

    const { data: newEntry } = await supabase
      .from("writing_progress_entries")
      .select("project_id, amount")
      .eq("member_id", memberId)
      .eq("external_id", trackbearExternalId("99999999-9999-4999-8999-999999999999"))
      .single();
    expect(newEntry).toEqual({ project_id: project!.id, amount: 700 });
  });

  it("paginates existing-entry lookups past Supabase's 1000-row limit", async () => {
    const data: TrackbearData = makeTrackbearData();
    const base = data.tallies[3];
    for (let i = 0; i < 1200; i++) {
      const hex = i.toString(16).padStart(12, "0");
      data.tallies.push({ ...base, id: 1000 + i, uuid: `eeeeeeee-eeee-4eee-8eee-${hex}` });
    }

    const first = await runTrackbearImport(supabase, memberId, data, fakeCoverCopier);
    expect(first.created.entries).toBe(1200);
    expect(await countRows("writing_progress_entries")).toBe(1205);

    const second = await runTrackbearImport(supabase, memberId, data, fakeCoverCopier);
    expect(second.created.entries).toBe(0);
    expect(second.alreadyImported.entries).toBe(1204); // everything in this export (the Feb tally isn't in it)
    expect(await countRows("writing_progress_entries")).toBe(1205);
  });
});
