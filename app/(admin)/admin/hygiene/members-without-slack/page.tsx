import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import MemberSlackSearchForm from "./MemberSlackSearchForm";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

export const metadata: Metadata = {
  title: "Members Without Slack",
};

export default async function MembersWithoutSlackPage() {
  const supabase = await createClient();

  const [
    { data: members },
    { data: slackUsers },
    { data: aliases },
  ] = await Promise.all([
    supabase.from("members").select("id, name, email, status").order("name"),
    supabase
      .schema("bronze")
      .from("slack_users")
      .select("user_id, email, real_name, display_name, is_bot, is_deleted"),
    supabase.from("member_name_aliases").select("alias, member_id, source"),
  ]);

  // Reuses the exact same matching logic as /admin/hygiene/unmatched-slack —
  // just read in the opposite direction (members with no matched Slack user,
  // instead of Slack users with no matched member). This is the check that
  // catches members who never joined Slack at all (no slack_users row to
  // even be "unmatched") in addition to ones whose name/email just didn't
  // resolve automatically.
  const userToMemberMap = await matchSlackUsersToMembers(
    slackUsers || [],
    members || [],
    aliases || []
  );
  const matchedMemberIds = new Set(userToMemberMap.values());

  const unmatchedMembers = (members || [])
    .filter((m) => m.status === "active")
    .filter((m) => !matchedMemberIds.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, email: m.email }));

  const searchableSlackUsers = (slackUsers || [])
    .filter((u) => !u.is_bot)
    .map((u) => ({
      user_id: u.user_id,
      email: u.email,
      real_name: u.real_name,
      display_name: u.display_name,
      is_deleted: u.is_deleted,
    }));

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Members Without Slack</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Active members with no matched Slack account — including members who never joined
          Slack at all, which the reverse (Slack → member) check on the hygiene dashboard can&apos;t
          see.
        </p>
      </div>

      <MemberSlackSearchForm unmatchedMembers={unmatchedMembers} slackUsers={searchableSlackUsers} />
    </div>
  );
}
