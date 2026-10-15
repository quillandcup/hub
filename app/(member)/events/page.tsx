import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { localDateString, parseEventFilter } from "@/lib/events-filter";
import { fetchUpcomingEducationalPrickles } from "@/lib/educational-prickles";
import EventsBrowser, { type EventRow } from "./EventsBrowser";
import { ORG_TIMEZONE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Events",
};

type RawEvent = Omit<EventRow, "cover_photo_id"> & { event_photos: { id: string; hidden_at: string | null }[] | null };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [enabledFeatures, tzPref] = await Promise.all([
    getUserFeaturePreviews(user.id),
    getUserTimezonePreference(),
  ]);
  if (!enabledFeatures.includes("events")) redirect("/dashboard");

  const { type: rawType } = await searchParams;
  const initialFilter = parseEventFilter(rawType);
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  const now = new Date();

  const [{ data: events }, educationalPrickles] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, title, event_type, location, starts_at, ends_at, focus, event_photos(id, hidden_at)")
      .order("starts_at", { ascending: false }),
    fetchUpcomingEducationalPrickles(supabase, now),
  ]);

  const rows: EventRow[] = ((events ?? []) as RawEvent[]).map((e) => ({
    id: e.id,
    slug: e.slug,
    title: e.title,
    event_type: e.event_type,
    location: e.location,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    focus: e.focus,
    cover_photo_id: (e.event_photos || []).find((p) => !p.hidden_at)?.id ?? null,
  }));

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Events</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Retreats, educational prickles, and other gatherings — what&apos;s coming up and where we&apos;ve been.
      </p>
      <EventsBrowser
        key={initialFilter}
        initialFilter={initialFilter}
        events={rows}
        educationalPrickles={educationalPrickles}
        today={localDateString(now, timeZone)}
        timeZone={timeZone}
      />
    </div>
  );
}
