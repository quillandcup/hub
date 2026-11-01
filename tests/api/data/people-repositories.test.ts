import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAdminWorkQueueRepository } from "@/lib/data/admin-work";
import { SupabaseAwardRepository } from "@/lib/data/awards";
import { SupabaseMemberProfileRepository } from "@/lib/data/member-profile";
import { SupabaseMentorshipRepository } from "@/lib/data/mentorship";
import { SupabaseOutreachRepository } from "@/lib/data/outreach";
import { SupabaseStaffRepository } from "@/lib/data/staff";
import { defineAdminWorkContract } from "@/tests/helpers/admin-work-contract";
import { defineAwardsContract } from "@/tests/helpers/awards-contract";
import { defineMemberProfileContract } from "@/tests/helpers/member-profile-contract";
import { defineMentorshipContract } from "@/tests/helpers/mentorship-contract";
import { defineOutreachContract } from "@/tests/helpers/outreach-contract";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { defineStaffContract } from "@/tests/helpers/staff-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let members: PeopleMember[] = [];
let userId = "";
const staffIds: string[] = [];

const ids = () => members.map((m) => m.id);
const must = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
/** Deletes the rows of a table that belong to the run's members (by the given member column). */
const clearBy = async (table: string, column: string) => {
  const { error } = await (db as unknown as { from: (t: string) => { delete: () => { in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }> } } })
    .from(table)
    .delete()
    .in(column, ids());
  must(error);
};

beforeAll(async () => {
  members = await createRunMembers(db, "people-repo", RUN, 4);
  userId = await createRunUser(admin, "people-repo-user", RUN);
});

afterAll(async () => {
  if (staffIds.length > 0) await db.from("staff").delete().in("id", staffIds);
  await db.from("dismissed_duplicate_groups").delete().like("group_key", `dup-${RUN}-%`);
  await db.from("feedback").delete().like("message", `% ${RUN}`);
  await deleteRunMembers(db, members); // cascades to everything that hangs off a member
  if (userId) await admin.auth.admin.deleteUser(userId);
});

defineStaffContract("SupabaseStaffRepository", () => ({
  repo: () => new SupabaseStaffRepository(db),
  get members() {
    return members;
  },
  seed: async (staff) => {
    if (staffIds.length > 0) must((await db.from("staff").delete().in("id", staffIds.splice(0))).error);
    const rows = staff.map((s, i) => ({ name: s.name, email: `people-repo-staff-${RUN}-${i}@example.com`, role: s.role, hire_date: s.hireDate ?? null }));
    const { data, error } = await db.from("staff").insert(rows).select("id, email");
    must(error);
    const created = rows.map((r) => data!.find((d) => d.email === r.email)!.id);
    staffIds.push(...created);
    return created;
  },
}));

defineMentorshipContract("SupabaseMentorshipRepository", () => ({
  repo: () => new SupabaseMentorshipRepository(db),
  get members() {
    return members;
  },
  missingId: MISSING_UUID,
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  clear: async () => {
    await clearBy("mentorships", "new_member_id");
    await clearBy("mentorships", "mentor_member_id");
    await clearBy("big_sister_volunteers", "member_id");
  },
}));

defineMemberProfileContract("SupabaseMemberProfileRepository", () => ({
  repo: () => new SupabaseMemberProfileRepository(db),
  get members() {
    return members;
  },
  get userId() {
    return userId;
  },
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  seedSlackConnection: async (memberId, slackUserId, options = {}) => {
    const { error } = await db.from("member_slack_connections").insert({
      member_id: memberId,
      slack_user_id: slackUserId,
      scopes: options.scopes ?? [],
      revoked_at: options.revoked ? new Date().toISOString() : null,
    });
    must(error);
  },
  clear: async () => {
    await clearBy("member_ask_me_about", "member_id");
    await clearBy("member_notes", "author_member_id");
    await clearBy("member_notes", "subject_member_id");
    await clearBy("member_roster_opt_outs", "member_id");
    await clearBy("member_onboarding", "member_id");
    await clearBy("member_slack_connections", "member_id");
  },
}));

defineAwardsContract("SupabaseAwardRepository", () => ({
  repo: () => new SupabaseAwardRepository(db),
  get members() {
    return members;
  },
  missingId: MISSING_UUID,
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  clear: () => clearBy("member_awards", "member_id"),
}));

defineOutreachContract("SupabaseOutreachRepository", () => ({
  repo: () => new SupabaseOutreachRepository(db),
  get members() {
    return members;
  },
  get userId() {
    return userId;
  },
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  clear: async () => {
    await clearBy("outreach_leads", "member_id");
    await clearBy("outreach_touches", "member_id");
  },
}));

defineAdminWorkContract("SupabaseAdminWorkQueueRepository", () => ({
  repo: () => new SupabaseAdminWorkQueueRepository(db),
  get members() {
    return members;
  },
  get userId() {
    return userId;
  },
  missingId: MISSING_UUID,
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  run: RUN,
  clear: async () => {
    await clearBy("admin_work_queue_completions", "member_id");
    must((await db.from("dismissed_duplicate_groups").delete().like("group_key", `dup-${RUN}-%`)).error);
    must((await db.from("feedback").delete().like("message", `% ${RUN}`)).error);
  },
}));
