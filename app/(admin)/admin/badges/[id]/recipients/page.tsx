import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getBadgeRecipients, type BadgeLevel, type BadgeType } from "@/lib/badges";
import BadgeRecipientsTable from "./BadgeRecipientsTable";
import AwardBadgeForm from "./AwardBadgeForm";

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

  const { data: linkedEvent } = badgeType.event_id
    ? await supabase.from("events").select("id, title").eq("id", badgeType.event_id).single()
    : { data: null };

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
            {linkedEvent && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Granted by attendance —{" "}
                <Link href={`/admin/events/${linkedEvent.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                  manage attendees
                </Link>
              </span>
            )}
          </div>

          {!badgeType.is_automatic && !badgeType.event_id && <AwardBadgeForm badgeTypeId={badgeType.id} />}

          {recipients.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No members have earned this badge yet.
            </div>
          ) : (
            <BadgeRecipientsTable
              recipients={recipients}
              firstAwardedLabel={badgeType.is_automatic ? "First eligible" : "First awarded"}
            />
          )}
        </div>
      </main>
    </div>
  );
}
