import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBadgeRecipients, getMemberBadges, type BadgeLevel, type BadgeType } from "@/lib/badges";
import { createRepos } from "@/lib/data/repos";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

/**
 * The Finisher and Author badges against the real database: the seeded badge types and levels, the viewer rules (a private
 * milestone counts only for its member), the while-a-member rule, and the all-members scan past 1,000 rows.
 */
describe("Finisher and Author badges (local database)", () => {
  const supabase = getTestSupabaseAdminClient();
  const repos = createRepos(supabase);
  const RUN = `${Date.now()}`;
  let memberId = "";
  let otherId = "";
  let userId = "";

  const row = (member: string, over: Record<string, unknown>) => ({
    member_id: member,
    kind: "the_end",
    source: "member",
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    visibility: "community",
    created_by: userId,
    ...over,
  });
  const insert = async (rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("member_milestones").insert(rows.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }
  };

  beforeAll(async () => {
    const { data: members, error } = await supabase
      .from("members")
      .insert([
        { name: `Badge Writer ${RUN}`, email: `badge-writer-${RUN}@example.com`, joined_at: "2026-01-01", first_joined_at: "2026-01-10", status: "active" },
        { name: `Badge Reader ${RUN}`, email: `badge-reader-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" },
      ])
      .select("id, email")
      .order("email");
    if (error) throw new Error(error.message);
    memberId = members![1].id;
    otherId = members![0].id;
    const user = await supabase.auth.admin.createUser({ email: `badge-staff-${RUN}@example.com`, email_confirm: true });
    if (user.error) throw new Error(user.error.message);
    userId = user.data.user.id;
  }, 60_000);

  afterAll(async () => {
    await supabase.from("member_milestones").delete().in("member_id", [memberId, otherId]);
  });

  it("seeds both badges as automatic and levelled at 1, 3, 5 and 10", async () => {
    for (const [key, label] of [["finisher", "Finisher"], ["author", "Author"]] as const) {
      const type = await repos.badges.typeByKey(key);
      expect(type).toMatchObject({ is_automatic: true, has_levels: true });
      const levels = (await repos.badges.levels()).filter((l) => l.badge_type_id === type!.id).sort((a, b) => a.level - b.level);
      expect(levels.map((l) => [l.name, l.threshold])).toEqual([[label, 1], [`3x ${label}`, 3], [`5x ${label}`, 5], [`10x ${label}`, 10]]);
    }
  });

  it("counts, per viewer and while a member, and scans every member past 1,000 rows", async () => {
    await insert([
      row(memberId, { title: "Shown Work" }),
      row(memberId, { title: "Private Work", visibility: "private" }),
      row(memberId, { title: "Globe Work", visibility: "public" }),
      row(memberId, { title: "Before Joining", achieved_on: "2026-01-09" }),
      row(memberId, { title: "On The Day", achieved_on: "2026-01-10" }),
      row(memberId, { title: "Proposed Work", status: "proposed", confirmed_at: null, visibility: "private", source: "staff", created_by: null }),
      row(memberId, { title: "Taken Back", deleted_at: new Date().toISOString() }),
      row(memberId, { title: "Manuscript", kind: "publish_ready", visibility: "private" }),
    ]);
    // More than one page of rows for another member, so the all-members scan has to page.
    await insert(Array.from({ length: 1_001 }, (_, i) => row(otherId, { title: `Bulk Work ${i}` })));

    const levelOf = async (viewer: "self" | "others") =>
      (await getMemberBadges(repos, memberId, 0, "2026-01-10", viewer)).filter((b) => ["finisher", "author"].includes(b.badgeType.key)).map((b) => [b.badgeType.key, b.occurrences]);
    expect(await levelOf("self")).toEqual(expect.arrayContaining([["finisher", 4], ["author", 1]]));
    expect(await levelOf("others")).toEqual([["finisher", 3]]);

    const type = (await repos.badges.typeByKey("finisher")) as BadgeType;
    const levels = (await repos.badges.levels()).filter((l) => l.badge_type_id === type.id) as BadgeLevel[];
    const recipients = await getBadgeRecipients(repos, type, levels);
    expect(recipients.find((r) => r.memberId === memberId)).toMatchObject({ occurrences: 3, levelName: "3x Finisher" });
    expect(recipients.find((r) => r.memberId === otherId)).toMatchObject({ occurrences: 1_001, levelName: "10x Finisher" });
    expect(await repos.milestones.allShownToMembers().then((all) => all.filter((m) => m.memberId === otherId).length)).toBe(1_001);
  }, 120_000);
});
