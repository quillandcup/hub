import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getBadgeRecipients, type BadgeLevel, type BadgeType } from "@/lib/badges";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: badgeType } = await supabase.from("badge_types").select("name").eq("id", id).single();
  return { title: badgeType ? `${badgeType.name} recipients` : "Badge recipients" };
}

export default async function BadgeRecipientsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: badgeType }, { data: levels }] = await Promise.all([
    supabase.from("badge_types").select("*").eq("id", id).single(),
    supabase.from("badge_levels").select("*").eq("badge_type_id", id).order("level"),
  ]);

  if (!badgeType) notFound();

  const recipients = await getBadgeRecipients(
    supabase,
    badgeType as BadgeType,
    (levels ?? []) as BadgeLevel[]
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/badges"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Badges
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span>{badgeType.icon}</span>
            {badgeType.name}
          </h1>
          {badgeType.description && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{badgeType.description}</p>
          )}
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {recipients.length} {recipients.length === 1 ? "recipient" : "recipients"}
            </h2>
            {badgeType.is_automatic && (
              <span className="text-xs text-slate-400 dark:text-slate-500">Computed automatically</span>
            )}
          </div>

          {recipients.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No members have earned this badge yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Member
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Level
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Occurrences
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {badgeType.is_automatic ? "First eligible" : "First awarded"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {recipients.map((recipient) => (
                    <tr key={recipient.memberId}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          href={`/admin/members/${recipient.memberId}`}
                          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {recipient.memberName}
                        </Link>
                        <div className="text-sm text-slate-500 dark:text-slate-400">{recipient.memberEmail}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                        {recipient.levelName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                        {recipient.occurrences}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                        {recipient.firstAwardedAt ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
