import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createRepos } from "@/lib/data/repos";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { localDateString } from "@/lib/events-filter";
import { ORG_TIMEZONE } from "@/lib/config";
import { eventDisplayName } from "@/lib/event-name";
import { eventDays, type EventRow } from "../AgendaList";
import PastEventsBrowser from "./PastEventsBrowser";

export const metadata: Metadata = {
  title: "Past events · Events",
};

export default async function PastEventsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [enabledFeatures, tzPref] = await Promise.all([getUserFeaturePreviews(user.id), getUserTimezonePreference()]);
  if (!enabledFeatures.includes("events")) redirect("/dashboard");

  const { month } = await searchParams;
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;
  const today = localDateString(new Date(), timeZone);

  const events = await createRepos(supabase).events.listWithCover();
  // A removed event isn't listed. Past is what has already ended in the viewer's zone, so an event earlier today is here too.
  const rows: EventRow[] = events
    .filter((e) => !e.deleted_at)
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      title: eventDisplayName(e.title, e.speakers, e.host_name),
      event_type: e.event_type,
      location: e.location,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      start_time: e.start_time,
      end_time: e.end_time,
      focus: e.focus,
      registration: e.registration,
      cover_photo_id: e.coverPhotoId,
    }))
    .filter((e) => eventDays(e, timeZone).endDate < today);

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <p className="mb-2 text-sm">
        <Link href="/events" className="text-plum-600 dark:text-plum-400 hover:underline">← Upcoming events</Link>
      </p>
      <h1 className="text-2xl font-bold mb-1">Past events</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">Where we&apos;ve been, a month at a time.</p>
      <PastEventsBrowser initialMonth={month ?? null} events={rows} timeZone={timeZone} />
    </div>
  );
}
