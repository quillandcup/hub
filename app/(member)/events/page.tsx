import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { localDateString, parseEventFilter } from "@/lib/events-filter";
import EventsBrowser, { type EducationalPrickle, type EventRow } from "./EventsBrowser";

export const metadata: Metadata = {
  title: "Events",
};

const ORG_TIMEZONE = "America/New_York";
// How far ahead to look for educational prickles. They're scheduled a month or two out
// on the shared calendar; this keeps the list to what's actually been announced.
const EDUCATIONAL_WINDOW_DAYS = 90;
// Well under Supabase's 1000-row cap -- educational prickles are a few per month.
const EDUCATIONAL_LIMIT = 200;

type NameRef = { name: string } | { name: string }[] | null;

type RawEvent = Omit<EventRow, "cover_photo_id"> & { event_photos: { id: string; hidden_at: string | null }[] | null };
type RawEducational = {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  host: NameRef;
  prickle_types: NameRef;
};

function unwrapName(ref: NameRef): string | null {
  if (Array.isArray(ref)) return ref[0]?.name ?? null;
  return ref?.name ?? null;
}

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
  const windowEnd = new Date(now.getTime() + EDUCATIONAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [{ data: events }, { data: educational }] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, title, event_type, location, starts_at, ends_at, focus, event_photos(id, hidden_at)")
      .order("starts_at", { ascending: false }),
    supabase
      .from("prickles")
      .select("id, title, start_time, end_time, host:members(name), prickle_types!inner(name, normalized_name)")
      .eq("prickle_types.normalized_name", "educational")
      .gte("end_time", now.toISOString())
      .lte("start_time", windowEnd.toISOString())
      .order("start_time", { ascending: true })
      .limit(EDUCATIONAL_LIMIT),
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

  const educationalPrickles: EducationalPrickle[] = ((educational ?? []) as unknown as RawEducational[]).map((p) => ({
    id: p.id,
    title: p.title ?? null,
    typeName: unwrapName(p.prickle_types) ?? "Educational Prickle",
    hostName: unwrapName(p.host),
    startTime: p.start_time,
    endTime: p.end_time,
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
