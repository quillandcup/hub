import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import EventDetailClient from "./EventDetailClient";
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

  const { data: event } = await supabase.from("events").select("*").eq("slug", slug).single();
  if (!event) notFound();

  const [{ data: visiblePhotos }, effectiveIdentity, calendarItems] = await Promise.all([
    supabase
      .from("event_photos")
      .select("id, width, height")
      .eq("event_id", event.id)
      .is("hidden_at", null)
      .order("taken_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    getEffectiveIdentity(user),
    getMyCalendarItems(),
  ]);

  // Upcoming (or ongoing) events can go in the member's synced calendar -- retreats included,
  // whether or not they've signed up; it's their calendar.
  const isUpcoming = event.ends_at >= new Date().toISOString().slice(0, 10);
  const calendarItemId =
    calendarItems.find((item) => item.kind === "event" && item.eventId === event.id)?.id ?? null;
  const calendarControl =
    effectiveIdentity && isUpcoming ? <AddEventToCalendar eventId={event.id} itemId={calendarItemId} /> : null;

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <Link href="/events" className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
        ← All Events
      </Link>
      <EventDetailClient event={event} photos={visiblePhotos || []} calendarControl={calendarControl} />
    </div>
  );
}
