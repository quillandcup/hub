"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { formatDateOnly } from "@/lib/formatters";
import EventAudienceFields from "@/components/EventAudienceFields";
import { audienceSummary, type EventAudience } from "@/lib/event-audience";
import { EVENT_TYPE_OPTIONS } from "@/lib/events-filter";
import PrickleDescription from "@/components/PrickleDescription";
import MediaPicker, { type EventPhotos } from "@/components/media/MediaPicker";
import { mediaSrc } from "@/lib/media/url";

export interface EventData extends EventAudience {
  id: string;
  slug: string;
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
  /** The cover picked from the media library. */
  image_id: string | null;
  calendar_event_id: string | null;
  overridden_fields: string[];
  deleted_at: string | null;
}

const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded disabled:opacity-60";
const LABEL = "text-gray-500 dark:text-gray-400";

/** One value of the card: its label with the value, or, while editing, with the field that takes its place. */
function Field({ label, htmlFor, wide = false, children }: { label: string; htmlFor?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "@pair:col-span-2" : undefined}>
      <dt>
        <label htmlFor={htmlFor} className={LABEL}>
          {label}
        </label>
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * The Details card of the admin event page. Edit turns each value into its field in the same place, with Save and
 * Cancel; what a prickle or the calendar owns is shown locked, and one notice says which. `onSave` returns an error
 * message, or null when it saved.
 */
export default function EventDetailsCard({
  event,
  prickleId,
  onSave,
  onToggleRemoved,
  removing,
  onRevert,
  reverting,
  photos,
}: {
  event: EventData;
  prickleId: string | null;
  onSave: (form: EventData) => Promise<string | null>;
  onToggleRemoved: () => void;
  removing: boolean;
  onRevert: () => void;
  reverting: boolean;
  /** The event's visible gallery photos, offered as cover choices. */
  photos?: EventPhotos["photos"];
}) {
  const [form, setForm] = useState<EventData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = form !== null;
  const followsCalendar = !!event.calendar_event_id;
  const set = (patch: Partial<EventData>) => form && setForm({ ...form, ...patch });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    const failed = await onSave(form);
    setSaving(false);
    if (failed) setError(failed);
    else setForm(null);
  }

  const view = (value: ReactNode) => <span className="whitespace-pre-wrap">{value}</span>;

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Details</h2>
        {!editing && (
          <div className="flex gap-4">
            <button type="button" disabled={removing} onClick={onToggleRemoved} className="text-plum-600 dark:text-plum-400 hover:underline text-sm disabled:opacity-50">
              {event.deleted_at ? "Add back to Events" : "Remove from Events"}
            </button>
            <button type="button" onClick={() => setForm(event)} className="text-plum-600 dark:text-plum-400 hover:underline text-sm">
              Edit
            </button>
          </div>
        )}
      </div>

      {event.deleted_at && (
        <div className="mb-4 p-3 rounded bg-amber-50 dark:bg-amber-900/20 text-sm">
          Removed from Events: members don&apos;t see it in Events, search or their calendar feed.
          {followsCalendar ? " The calendar sync leaves it removed." : ""}
        </div>
      )}

      {followsCalendar && (
        <div className="mb-4 p-3 rounded bg-plum-50 dark:bg-plum-900/20 text-sm">
          <p>
            {prickleId && (
              <>
                Stands for a prickle: its title, description, guest speaker and host come from it (
                <Link href={`/admin/prickles/${prickleId}`} className="text-plum-600 dark:text-plum-400 hover:underline">
                  edit them on the prickle
                </Link>
                ).{" "}
              </>
            )}
            Follows the shared calendar: dates and times come from it
            {event.overridden_fields.length > 0
              ? `, and you changed the ${event.overridden_fields.join(", ")}.`
              : prickleId
                ? "; the location does too until you change it."
                : "; the title, description and location do too until you change them."}
          </p>
          {event.overridden_fields.length > 0 && (
            <button type="button" disabled={reverting} onClick={onRevert} className="mt-1 text-plum-600 dark:text-plum-400 hover:underline disabled:opacity-50">
              {reverting ? "Updating..." : "Follow the calendar again"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={save}>
        <div className="@container">
          <dl className="grid grid-cols-1 @pair:grid-cols-2 gap-4 text-sm">
            {(editing || event.title) && (
              <Field label="Title" htmlFor="event-title" wide>
                {form ? (
                  <input id="event-title" type="text" value={form.title} disabled={!!prickleId} required={!prickleId} onChange={(e) => set({ title: e.target.value })} className={INPUT} />
                ) : (
                  event.title
                )}
              </Field>
            )}
            <Field label="Type" htmlFor="event-type">
              {form ? (
                <select id="event-type" value={form.event_type} onChange={(e) => set({ event_type: e.target.value })} className={INPUT}>
                  {EVENT_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              ) : (
                EVENT_TYPE_OPTIONS.find((t) => t.value === event.event_type)?.label || event.event_type
              )}
            </Field>
            {form ? (
              <>
                <Field label="Starts" htmlFor="event-starts">
                  <input id="event-starts" type="date" value={form.starts_at} disabled={followsCalendar} required onChange={(e) => set({ starts_at: e.target.value })} className={INPUT} />
                </Field>
                <Field label="Ends" htmlFor="event-ends">
                  <input id="event-ends" type="date" value={form.ends_at} disabled={followsCalendar} required onChange={(e) => set({ ends_at: e.target.value })} className={INPUT} />
                </Field>
              </>
            ) : (
              <Field label="Dates">
                {formatDateOnly(event.starts_at)} – {formatDateOnly(event.ends_at)}
              </Field>
            )}
            {(editing || event.location) && (
              <Field label="Location" htmlFor="event-location">
                {form ? (
                  <input id="event-location" type="text" value={form.location ?? ""} onChange={(e) => set({ location: e.target.value || null })} className={INPUT} />
                ) : (
                  event.location
                )}
              </Field>
            )}
            {form ? (
              <div className="@pair:col-span-2">
                <EventAudienceFields value={form} onChange={(audience) => set(audience)} speakersLocked={!!prickleId} />
              </div>
            ) : (
              <>
                <Field label="Who it's for">{[...audienceSummary(event), ...(event.announced_publicly ? ["Announced publicly"] : [])].join(" · ") || "Members, no sign-up"}</Field>
                {event.speakers && <Field label="Guest speakers">{event.speakers}</Field>}
              </>
            )}
            {(editing || event.focus) && (
              <Field label="Focus" htmlFor="event-focus" wide>
                {form ? <input id="event-focus" type="text" value={form.focus ?? ""} onChange={(e) => set({ focus: e.target.value || null })} className={INPUT} /> : event.focus}
              </Field>
            )}
            {(editing || event.description) && (
              <Field label="Description" htmlFor="event-description" wide>
                {form ? (
                  <textarea id="event-description" rows={2} value={form.description ?? ""} disabled={!!prickleId} onChange={(e) => set({ description: e.target.value || null })} className={INPUT} />
                ) : (
                  <PrickleDescription markdown={event.description ?? ""} className="" />
                )}
              </Field>
            )}
            {(editing || event.agenda) && (
              <Field label="Agenda" htmlFor="event-agenda" wide>
                {form ? <textarea id="event-agenda" rows={3} value={form.agenda ?? ""} onChange={(e) => set({ agenda: e.target.value || null })} className={INPUT} /> : view(event.agenda)}
              </Field>
            )}
            {(editing || event.results) && (
              <Field label="Results" htmlFor="event-results" wide>
                {form ? <textarea id="event-results" rows={2} value={form.results ?? ""} onChange={(e) => set({ results: e.target.value || null })} className={INPUT} /> : view(event.results)}
              </Field>
            )}
            {(editing || event.image_id) && (
              <Field label="Cover image" wide>
                {form ? (
                  <MediaPicker value={form.image_id} onChange={(image_id) => set({ image_id })} surface="event_cover" disabled={saving} eventPhotos={{ eventId: event.id, photos: photos ?? [] }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
                  <img src={mediaSrc(event.image_id as string, "event_card")} alt="The event's cover" className="w-full max-w-xs aspect-video object-cover rounded border border-gray-200 dark:border-slate-700" />
                )}
              </Field>
            )}
            {(editing || event.google_photos_album_url) && (
              <Field label="Google Photos album" htmlFor="event-album" wide>
                {form ? (
                  <input id="event-album" type="url" value={form.google_photos_album_url ?? ""} onChange={(e) => set({ google_photos_album_url: e.target.value || null })} className={INPUT} />
                ) : (
                  <a href={event.google_photos_album_url ?? ""} target="_blank" rel="noopener noreferrer" className="text-plum-600 dark:text-plum-400 hover:underline">
                    {event.google_photos_album_url}
                  </a>
                )}
              </Field>
            )}
          </dl>
        </div>

        {editing && (
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50 text-sm">
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(null);
                setError(null);
              }}
              className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
            >
              Cancel
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
