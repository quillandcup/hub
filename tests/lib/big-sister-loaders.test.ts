import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { fetchTrialWindows } from "@/lib/trial-window";
import { getVolunteers } from "@/lib/big-sister-volunteers";
import { getMentorships } from "@/lib/mentorship";
import { getMyMentorships } from "@/lib/my-mentorship";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
const client = (db: ReturnType<typeof createFakeSupabase>) => db as unknown as SupabaseClient;
describe("Big Sister query boundaries", () => {
  it("finds multiple Stripe trials through canonical emails and aliases without mixing members", async () => {
    const trial = { trial_start: Date.parse("2026-10-01") / 1000, trial_end: Date.parse("2026-10-08") / 1000 };
    const db = createFakeSupabase({
      member_email_aliases: { data: [{ member_id: "ada", alias_email: "OLD@EXAMPLE.TEST" }] },
      "bronze.stripe_customers": { data: [{ stripe_customer_id: "a", email: "old@example.test" }, { stripe_customer_id: "b", email: "bea@example.test" }, { stripe_customer_id: "none", email: null }, { stripe_customer_id: "unknown", email: "other@example.test" }] },
      "bronze.stripe_subscriptions": { data: [{ stripe_customer_id: "a", data: trial }, { stripe_customer_id: "a", data: trial }, { stripe_customer_id: "b", data: null }, { stripe_customer_id: "unknown", data: trial }] },
    });
    const result = await fetchTrialWindows(client(db), [{ id: "ada", email: "ADA@example.test" }, { id: "bea", email: "bea@example.test" }]);
    expect(result.get("ada")).toEqual([{ start: "2026-10-01", end: "2026-10-08" }, { start: "2026-10-01", end: "2026-10-08" }]);
    expect(result.has("bea")).toBe(false); expect(result.has("unknown")).toBe(false);
  });
  it("avoids Stripe requests when there are no members or matching customers", async () => {
    const db = createFakeSupabase();
    expect(await fetchTrialWindows(client(db), [])).toEqual(new Map()); expect(db.queries).toHaveLength(0);
    expect(await fetchTrialWindows(client(db), [{ id: "a", email: "a@example.test" }])).toEqual(new Map());
    expect(db.queries.some(q => q.table === "bronze.stripe_subscriptions")).toBe(false);
  });
  it("names volunteers, normalizes member embeds and leaves out withdrawn rows", async () => {
    const mentorships = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bea" },
        ],
        bigSisterVolunteers: [
          { member_id: "mbr_AAAAAAAAAAA1", note: null, created_at: "2026-01-01", updated_at: "2026-01-01", deleted_at: null },
          { member_id: "mbr_AAAAAAAAAAA2", note: "Hi", created_at: "2026-01-01", updated_at: "2026-01-01", deleted_at: "2026-02-01" },
          { member_id: "mbr_GONE00000000", note: null, created_at: "2026-01-01", updated_at: "2026-01-01", deleted_at: null },
        ],
      }),
    ).mentorship;
    const volunteers = await getVolunteers(mentorships);
    expect(volunteers).toHaveLength(2);
    expect(volunteers[0].name).toBe("Ada");
    expect(volunteers[1].name).toBe("Unknown member");
  });
  it("names a volunteer by display name and keeps the legal name beside it", async () => {
    const mentorships = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example" },
        ],
        bigSisterVolunteers: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"].map((member_id) => ({ member_id, note: null, created_at: "2026-01-01", updated_at: "2026-01-01", deleted_at: null })),
      }),
    ).mentorship;
    const volunteers = await getVolunteers(mentorships);
    expect(volunteers[0]).toMatchObject({ name: "Ada E", realName: "Ada Example" });
    expect(volunteers[1]).toMatchObject({ name: "Bo Example" }); expect(volunteers[1].realName).toBeUndefined();
  });
  it("loads the matches and derives outcomes from membership instead of storing them", async () => {
    const row = { id: "match", mentor_member_id: "mbr_AAAAAAAAAAA1", new_member_id: "mbr_GONE00000000", started_on: "2026-10-01", trial_ends_on: null, kind: "direct", status: "matched", outcome_note: null, created_at: "2026-10-01", updated_at: "2026-10-01" };
    const mentorships = createInMemoryRepos(new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada" }], mentorships: [row] })).mentorship;
    const rows = await getMentorships(mentorships, "2026-10-15");
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ mentorName: "Ada", newMemberName: "Unknown member", outcome: "no_trial", active: true });
  });
  it("returns no matches for a member without any", async () => {
    const mentorships = createInMemoryRepos(new InMemoryDataset()).mentorship;
    expect(await getMyMentorships(mentorships, "mbr_AAAAAAAAAAA1", "2026-10-15")).toEqual({ bigSister: null, mentees: [] });
  });
});
