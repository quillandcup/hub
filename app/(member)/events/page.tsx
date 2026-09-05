import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";

export const metadata: Metadata = {
  title: "Events",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  in_person_retreat: "In-Person Retreat",
  virtual_retreat: "Virtual Retreat",
  other: "Event",
};

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function EventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/dashboard");

  const { data: events } = await supabase
    .from("events")
    .select("id, slug, title, event_type, location, starts_at, ends_at, focus, event_photos(id, hidden_at)")
    .order("starts_at", { ascending: false });

  const rows = (events || []).map((e: any) => ({
    ...e,
    cover_photo_id: (e.event_photos || []).find((p: any) => !p.hidden_at)?.id ?? null,
  }));
  const today = new Date().toISOString().split("T")[0];
  const upcoming = rows.filter((e) => e.ends_at >= today);
  const past = rows.filter((e) => e.ends_at < today);

  function EventCard({ event }: { event: (typeof rows)[number] }) {
    return (
      <Link
        href={`/events/${event.slug}`}
        className="block bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="aspect-video bg-slate-100 dark:bg-slate-800">
          {event.cover_photo_id && (
            // eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route
            <img
              src={`/api/events/${event.id}/photos/${event.cover_photo_id}`}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
          </p>
          <h3 className="font-semibold mt-0.5">{event.title}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {fmtDate(event.starts_at)} – {fmtDate(event.ends_at)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          {event.focus && <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">{event.focus}</p>}
        </div>
      </Link>
    );
  }

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Events</h1>

      {upcoming.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            Upcoming
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Past</h2>
        {past.length === 0 ? (
          <p className="text-slate-500">No past events yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {past.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
