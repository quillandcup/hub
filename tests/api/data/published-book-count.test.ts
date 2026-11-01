import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBadgeRecipients, getPublishedBookCount, type BadgeLevel, type BadgeType } from "@/lib/badges";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

/**
 * A book its owner deleted stays in member_books (soft delete) but doesn't count toward the
 * Published Author badge, in the one-member count or in the all-members scan.
 */
describe("published book counts (local database)", () => {
  const supabase = getTestSupabaseAdminClient();
  const RUN = `${Date.now()}`;
  let memberId = "";
  let badgeType: BadgeType;
  let levels: BadgeLevel[];

  const book = (title: string, deletedAt: string | null) => ({
    member_id: memberId,
    title,
    cover_url: "https://example.com/cover.png",
    purchase_url: "https://example.com/buy",
    published_date: "2026-03-05",
    deleted_at: deletedAt,
  });

  beforeAll(async () => {
    const { data: member, error } = await supabase
      .from("members")
      .insert({ name: `Book Counter ${RUN}`, email: `book-counter-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    memberId = member.id;

    const { error: booksError } = await supabase
      .from("member_books")
      .insert([book(`Live ${RUN}`, null), book(`Deleted ${RUN}`, new Date().toISOString())]);
    if (booksError) throw new Error(booksError.message);

    const { data: type, error: typeError } = await supabase.from("badge_types").select("*").eq("key", "published_author").single();
    if (typeError) throw new Error(typeError.message);
    badgeType = type as BadgeType;
    const { data: levelRows, error: levelError } = await supabase.from("badge_levels").select("*").eq("badge_type_id", badgeType.id);
    if (levelError) throw new Error(levelError.message);
    levels = levelRows as BadgeLevel[];
  });

  afterAll(async () => {
    // Members cascade to their books.
    await supabase.from("members").delete().eq("id", memberId);
  });

  it("counts a member's live books only", async () => {
    expect(await getPublishedBookCount(supabase as SupabaseClient, memberId)).toBe(1);
  });

  it("counts live books only in the all-members scan the badge page uses", async () => {
    const recipients = await getBadgeRecipients(supabase as SupabaseClient, badgeType, levels);
    const mine = recipients.find((r) => r.memberId === memberId);
    expect(mine?.occurrences).toBe(1);
  });
});
