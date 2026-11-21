import { createRepos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { createClient } from "@/lib/supabase/server";
import { findMembersWithDisposableEmail } from "@/lib/disposable-email-members";
import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Temporary Email Addresses",
};

export default async function TemporaryEmailsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const repos = createRepos(supabase);

  const [members, aliases] = await Promise.all([
    repos.members.list({ status: "active", orderBy: "name" }),
    repos.aliases.emailAliases({ activeOnly: true }),
  ]);

  const flagged = findMembersWithDisposableEmail(members, aliases);

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <Link href="/admin/hygiene" className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          ← Data Health
        </Link>
        <h1 className="text-2xl font-bold mt-2">Temporary Email Addresses</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Active members whose email, or an email alias, is a temporary-mail (throwaway inbox) address. The opt-in form and
          &quot;add an email alias&quot; refuse these, but imports from Kajabi and Stripe do not, so this is where they show.
          Nothing is blocked or changed for these members.
        </p>
      </div>

      {flagged.length === 0 ? (
        <p className="text-sm text-green-600 dark:text-green-400">No temporary-mail addresses ✓</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
          {flagged.map((m) => {
            const shown = getMemberDisplayName({ name: m.name, display_name: m.displayName });
            const label = shown === m.name ? shown : `${shown} (${m.name})`;
            return (
              <li key={m.memberId} className="p-4">
                <Link href={`/admin/members/${m.memberId}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                  {label}
                </Link>
                <ul className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {m.addresses.map((a) => (
                    <li key={`${a.kind}:${a.email}`}>
                      {a.email} <span className="text-xs">({a.kind === "primary" ? "primary email" : "email alias"})</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
