import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import Link from "next/link";
import type { Metadata } from "next";
import AliasesTable from "./AliasesTable";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Name Aliases",
};

export default async function AliasListPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Get all aliases with their member info
  const repos = createRepos(supabase);
  const [aliases, identities] = await Promise.all([repos.aliases.namesWithMembers(), repos.members.identities()]);
  const displayNames = new Map(identities.map((m) => [m.id, m.displayName]));

  // Group aliases by member
  const aliasesByMember = new Map<string, typeof aliases>();
  for (const alias of aliases) {
    const list = aliasesByMember.get(alias.member.id) ?? [];
    list.push(alias);
    aliasesByMember.set(alias.member.id, list);
  }

  // Convert to sorted array
  const memberAliases = Array.from(aliasesByMember.entries())
    .map(([memberId, memberAliases]) => ({
      member: { ...memberAliases[0].member, displayName: displayNames.get(memberId) ?? null },
      aliases: memberAliases.map((a) => ({ id: a.id, alias: a.alias, created_at: a.createdAt })),
    }))
    .sort((a, b) => getMemberDisplayName({ name: a.member.name, display_name: a.member.displayName }).localeCompare(
        getMemberDisplayName({ name: b.member.name, display_name: b.member.displayName }),
      ));

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <Link href="/admin" className="text-plum-600 dark:text-plum-400 hover:underline mb-2 inline-block">
          ← Back to Dashboard
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold">Name Aliases</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              All configured aliases for matching Zoom names to members
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/hygiene/unmatched-zoom"
              className="px-4 py-2 bg-plum-600 hover:bg-plum-700 text-white rounded-lg font-medium transition-colors"
            >
              + Add New Aliases
            </Link>
            <RecordHistoryButton
              entityType={["member_name_alias", "member_email_alias", "ignored_zoom_name", "ambiguous_zoom_name", "ignored_slack_user"]}
              label="aliases and ignored names"
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 p-4 bg-plum-50 dark:bg-plum-900/20 border border-plum-200 dark:border-plum-800 rounded-lg">
        <p className="text-sm text-plum-900 dark:text-plum-100">
          <span className="font-bold">{aliases.length} aliases</span> configured for{" "}
          <span className="font-bold">{memberAliases.length} members</span>
        </p>
      </div>

      {/* Alias List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 overflow-hidden">
        {memberAliases.length === 0 ? (
          <div className="p-12 text-center text-slate-600 dark:text-slate-400">
            No aliases configured yet.{" "}
            <Link href="/admin/hygiene/unmatched-zoom" className="text-plum-600 dark:text-plum-400 hover:underline">
              Add your first alias
            </Link>
          </div>
        ) : (
          <AliasesTable rows={memberAliases} />
        )}
      </div>
    </div>
  );
}
