import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createRepos } from "@/lib/data/repos";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { localDateString, parseEventFilter } from "@/lib/events-filter";
import { fetchUpcomingEventPrickles, withoutFollowedEvents } from "@/lib/event-prickles";
import EventsBrowser, { type EventRow } from "./EventsBrowser";
import { ORG_TIMEZONE } from "@/lib/config";
import { eventDisplayName } from "@/lib/event-name";

export const metadata: Metadata = {
  title: "Events",
};

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

  const repos = createRepos(supabase);
  const [events, eventPrickles, badgeTypes] = await Promise.all([
    repos.events.listWithCover(),
    fetchUpcomingEventPrickles(supabase, now),
    repos.badges.types(),
  ]);
  const badgeIconOf = new Map(badgeTypes.flatMap((b) => (b.event_id ? [[b.event_id, b.icon] as const] : [])));

  // A hidden event isn't listed, and neither is the prickle it stands for.
  const rows: EventRow[] = events.filter((e) => !e.deleted_at).map((e) => ({
    id: e.id,
    slug: e.slug,
    title: eventDisplayName(e.title, e.speakers, e.host_name),
    event_type: e.event_type,
    location: e.location,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    focus: e.focus,
    registration: e.registration,
    badge_icon: badgeIconOf.get(e.id) ?? null,
    cover_photo_id: e.coverPhotoId,
  }));

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Events</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Retreats, educational events, sessions and other gatherings — what&apos;s coming up and where we&apos;ve been.
      </p>
      <EventsBrowser
        key={initialFilter}
        initialFilter={initialFilter}
        events={rows}
        eventPrickles={withoutFollowedEvents(
          eventPrickles,
          events.flatMap((e) => (e.calendar_event_id ? [e.calendar_event_id] : [])),
        )}
        today={localDateString(now, timeZone)}
        timeZone={timeZone}
      />
    </div>
  );
}
