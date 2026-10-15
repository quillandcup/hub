import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { fetchTrialWindows } from "@/lib/trial-window";
import { getVolunteers } from "@/lib/big-sister-volunteers";
import { getMentorships } from "@/lib/mentorship";
import { getMyMentorships } from "@/lib/my-mentorship";
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
  it("loads every volunteer page, normalizes member embeds, and excludes withdrawn rows in the query", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ member_id: `m${i}`, note: null, created_at: "2026-01-01", member: i === 0 ? [{ name: "Ada" }] : i === 1 ? null : { name: "Bea" } }));
    const db = createFakeSupabase({ big_sister_volunteers: { data: rows } });
    const volunteers = await getVolunteers(client(db));
    expect(volunteers).toHaveLength(1001); expect(volunteers[0].name).toBe("Ada"); expect(volunteers[1].name).toBe("Unknown member");
    expect(db.queries[1].calls).toContainEqual({ method: "range", args: [1000, 1999] });
    expect(db.queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });
  it("loads all match pages and derives outcomes from membership instead of storing them", async () => {
    const row = { id: "match", mentor_member_id: "a", new_member_id: "b", started_on: "2026-10-01", trial_ends_on: null, kind: "direct", status: "matched", outcome_note: null, mentor: [{ id: "a", name: "Ada" }], new_member: null };
    const db = createFakeSupabase({ mentorships: { data: Array.from({ length: 1000 }, (_, i) => ({ ...row, id: `${i}` })) } });
    const rows = await getMentorships(client(db), "2026-10-15");
    expect(rows).toHaveLength(1000); expect(rows[0]).toMatchObject({ mentorName: "Ada", newMemberName: "Unknown member", outcome: "no_trial", active: true });
    expect(db.queries[1].calls).toContainEqual({ method: "range", args: [1000, 1999] });
  });
  it("scopes the member RPC and returns no matches for an empty result", async () => {
    const db = createFakeSupabase();
    expect(await getMyMentorships(client(db), "a", "2026-10-15")).toEqual({ bigSister: null, mentees: [] });
    expect(db.queries[0].calls).toContainEqual({ method: "args", args: [{ p_member_id: "a" }] });
  });
});
