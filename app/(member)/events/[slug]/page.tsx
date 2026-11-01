import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { createRepos } from "@/lib/data/repos";
import { mediaSrc } from "@/lib/media/url";
import { getUserFeaturePreviews } from "@/lib/features.server";
import EventDetailClient from "./EventDetailClient";
import { getUserTimezonePreference } from "@/lib/timezone";
import { ORG_TIMEZONE } from "@/lib/config";
import { stripEventTag } from "@/lib/calendar-events";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getMyCalendarItems } from "@/app/(member)/my-prickles/calendar-feed-actions";
import { AddEventToCalendar } from "@/app/(member)/my-prickles/AddToCalendar";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/dashboard");

  const events = createRepos(supabase).events;
  const event = await events.visibleBySlug(slug);
  if (!event) notFound();

  const [visiblePhotos, effectiveIdentity, calendarItems, image, tzPref] = await Promise.all([
    events.visiblePhotos(event.id),
    getEffectiveIdentity(user),
    getMyCalendarItems(),
    event.image_id ? createRepos(supabase).media.byId(event.image_id).catch(() => null) : null,
    getUserTimezonePreference(),
  ]);
  // The member's own zone for the time of day ("browser" means not detected yet), as the Events list does.
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  // Upcoming (or ongoing) events can go in the member's synced calendar -- retreats included,
  // whether or not they've signed up; it's their calendar.
  const isUpcoming = event.ends_at >= new Date().toISOString().slice(0, 10);
  const calendarItemId =
    calendarItems.find((item) => item.kind === "event" && item.eventId === event.id)?.id ?? null;
  const calendarControl =
    effectiveIdentity && isUpcoming ? <AddEventToCalendar eventId={event.id} itemId={calendarItemId} /> : null;

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <Link data-track="event-all-events" href="/events" className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
        ← All Events
      </Link>
      <EventDetailClient
        event={{ ...event, description: stripEventTag(event.description) }}
        photos={visiblePhotos}
        timeZone={timeZone}
        calendarControl={calendarControl}
        coverImage={image && !image.deleted_at ? { src: mediaSrc(image.id, "event_hero"), alt: image.alt_text ?? "" } : null}
      />
    </div>
  );
}
