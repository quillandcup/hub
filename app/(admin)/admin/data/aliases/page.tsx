import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Metadata } from "next";
import AliasesTable from "./AliasesTable";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Name Aliases",
};

export default async function AliasListPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Get all aliases with their member info
  const { data: aliases } = await supabase
    .from("member_name_aliases")
    .select(`
      id,
      alias,
      member:members (
        id,
        name,
        email,
        status
      ),
      created_at
    `)
    .order("alias");

  // Group aliases by member
  const aliasesByMember = new Map<string, any[]>();
  aliases?.forEach((alias: any) => {
    // Supabase returns member as an array when using select with joins
    const member = Array.isArray(alias.member) ? alias.member[0] : alias.member;
    if (!member) return;

    const memberId = member.id;
    if (!aliasesByMember.has(memberId)) {
      aliasesByMember.set(memberId, []);
    }
    aliasesByMember.get(memberId)!.push({ ...alias, member });
  });

  // Convert to sorted array
  const memberAliases = Array.from(aliasesByMember.entries())
    .map(([memberId, memberAliases]) => ({
      member: memberAliases[0].member,
      aliases: memberAliases.map((a) => ({ id: a.id, alias: a.alias, created_at: a.created_at })),
    }))
    .sort((a, b) => a.member.name.localeCompare(b.member.name));

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <Link href="/admin" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
          ← Back to Dashboard
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold">Name Aliases</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              All configured aliases for matching Zoom names to members
            </p>
          </div>
          <Link
            href="/admin/hygiene/unmatched-zoom"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            + Add New Aliases
          </Link>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-900 dark:text-blue-100">
          <span className="font-bold">{aliases?.length || 0} aliases</span> configured for{" "}
          <span className="font-bold">{memberAliases.length} members</span>
        </p>
      </div>

      {/* Alias List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 overflow-hidden">
        {memberAliases.length === 0 ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            No aliases configured yet.{" "}
            <Link href="/admin/hygiene/unmatched-zoom" className="text-blue-600 dark:text-blue-400 hover:underline">
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
