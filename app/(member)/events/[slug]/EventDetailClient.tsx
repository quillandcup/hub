"use client";

import { useState } from "react";
import PhotoLightbox from "@/components/PhotoLightbox";

interface EventData {
  id: string;
  title: string;
  event_type: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  focus: string | null;
  description: string | null;
  agenda: string | null;
  results: string | null;
  google_photos_album_url: string | null;
}

interface Photo {
  id: string;
  width: number | null;
  height: number | null;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  in_person_retreat: "In-Person Retreat",
  virtual_retreat: "Virtual Retreat",
  other: "Event",
};

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function EventDetailClient({ event, photos }: { event: EventData; photos: Photo[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxPhotos = photos.map((p) => ({ id: p.id, src: `/api/events/${event.id}/photos/${p.id}` }));

  return (
    <div className="mt-4 space-y-6">
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
        </p>
        <h1 className="text-2xl font-bold mt-0.5">{event.title}</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          {fmtDate(event.starts_at)} – {fmtDate(event.ends_at)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>

      {(event.focus || event.description || event.agenda || event.results) && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-4">
          {event.focus && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Focus
              </h2>
              <p>{event.focus}</p>
            </div>
          )}
          {event.description && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                About
              </h2>
              <p className="whitespace-pre-wrap">{event.description}</p>
            </div>
          )}
          {event.agenda && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Agenda
              </h2>
              <p className="whitespace-pre-wrap">{event.agenda}</p>
            </div>
          )}
          {event.results && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Results
              </h2>
              <p className="whitespace-pre-wrap">{event.results}</p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Photos</h2>
          {event.google_photos_album_url && (
            <a
              href={event.google_photos_album_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View full album on Google Photos ↗
            </a>
          )}
        </div>

        {photos.length === 0 ? (
          <p className="text-slate-500">No photos yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {photos.map((photo, i) => (
              <button key={photo.id} onClick={() => setLightboxIndex(i)} className="aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route */}
                <img
                  src={`/api/events/${event.id}/photos/${photo.id}`}
                  alt=""
                  className="w-full h-full object-cover rounded"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <PhotoLightbox
        photos={lightboxPhotos}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
      />
    </div>
  );
}
