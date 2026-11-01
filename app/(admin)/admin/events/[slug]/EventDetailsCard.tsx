"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { formatDateOnly } from "@/lib/formatters";
import EventAudienceFields from "@/components/EventAudienceFields";
import { audienceSummary, type EventAudienceForm } from "@/lib/event-audience";
import { windowInputs } from "@/lib/event-window-inputs";
import { EVENT_TYPE_OPTIONS } from "@/lib/events-filter";
import PrickleDescription from "@/components/PrickleDescription";
import MemberSearch from "@/components/MemberSearch";
import type { EventOverrides } from "@/lib/prickle-edits";

export type { EventOverrides };
import MediaPicker, { type EventPhotos } from "@/components/media/MediaPicker";
import { mediaSrc } from "@/lib/media/url";

export interface EventData extends EventAudienceForm {
  id: string;
  slug: string;
  title: string;
  event_type: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  start_time: string;
  end_time: string;
  /** The host as members see them (a member's display name, or the free-text host of an event made in the Hub). */
  host_name: string | null;
  /** The member hosting it, when the schedule is a calendar prickle's. */
  host_id: string | null;
  focus: string | null;
  description: string | null;
  agenda: string | null;
  results: string | null;
  google_photos_album_url: string | null;
  /** The cover picked from the media library. */
  image_id: string | null;
  deleted_at: string | null;
}

/** The members the host of a calendar-backed event is picked from. */
export interface HostChoice {
  id: string;
  name: string;
  email: string;
  displayName?: string | null;
}

/** The card's form: the event with its window as Eastern dates and clock times (both clocks empty: all day). */
export type EventForm = EventData & { start_clock: string; end_clock: string };

const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded disabled:opacity-60";
const LABEL = "text-gray-500 dark:text-gray-400";

/** One value of the card: its label with the value, or, while editing, with the field that takes its place. */
function Field({ label, extra, htmlFor, wide = false, children }: { label: string; extra?: ReactNode; htmlFor?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "@pair:col-span-2" : undefined}>
      <dt>
        <label htmlFor={htmlFor} className={LABEL}>
          {label}
        </label>
        {extra}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * The Details card of the admin event page, the one place an event is edited. Edit turns each value into its field in
 * the same place, with Save and Cancel. The title, description, host, guest speaker and location are the schedule of
 * the prickle the event stands on and are editable for both kinds: an event made in the Hub keeps them (and its times)
 * in its Hub session; for one on a calendar prickle they are the calendar item's decision (they survive reprocessing,
 * marked "(edited)", and "Follow the calendar again" gives them back), and its times are read-only because they come
 * from Google Calendar. `onSave` returns an error message, or null when it saved.
 */
export default function EventDetailsCard({
  event,
  prickleId,
  hubSession,
  members,
  overridden,
  onSave,
  onToggleRemoved,
  removing,
  photos,
}: {
  event: EventData;
  /** The prickle the event stands on. */
  prickleId: string;
  /** Made in the Hub: its times are edited here too. Otherwise the calendar's, read-only. */
  hubSession: boolean;
  /** To pick the host of a calendar-backed event from. */
  members: HostChoice[];
  /** What was set by hand on a calendar-backed event. */
  overridden: EventOverrides;
  onSave: (form: EventForm) => Promise<string | null>;
  onToggleRemoved: () => void;
  removing: boolean;
  /** The event's visible gallery photos, offered as cover choices. */
  photos?: EventPhotos["photos"];
}) {
  const [form, setForm] = useState<EventForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = form !== null;
  const when = windowInputs(event.start_time, event.end_time);
  const set = (patch: Partial<EventForm>) => form && setForm({ ...form, ...patch });
  // The schedule's text fields are inputs for both kinds while editing; the times only for an event made in the Hub.
  const scheduleForm = form;
  const timesForm = hubSession ? form : null;
  const edited = (isOverridden: boolean) => (!hubSession && isOverridden ? <span className="ml-1 text-xs text-plum-600 dark:text-plum-400">(edited)</span> : null);
  // Emptying a field that was set by hand gives it back to the calendar when saved.
  const followAgain = (isOverridden: boolean, clear: () => void) =>
    !hubSession && isOverridden ? (
      <button type="button" onClick={clear} className="ml-2 text-xs text-plum-600 dark:text-plum-400 hover:underline">
        Follow the calendar again
      </button>
    ) : null;

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
            <Link href={`/admin/prickles/${prickleId}`} className="text-plum-600 dark:text-plum-400 hover:underline text-sm">
              View prickle
            </Link>
            <button type="button" disabled={removing} onClick={onToggleRemoved} className="text-plum-600 dark:text-plum-400 hover:underline text-sm disabled:opacity-50">
              {event.deleted_at ? "Add back to Events" : "Remove from Events"}
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...event, starts_at: when.startDate, ends_at: when.endDate, start_clock: when.startClock, end_clock: when.endClock })}
              className="text-plum-600 dark:text-plum-400 hover:underline text-sm"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {event.deleted_at && (
        <div className="mb-4 p-3 rounded bg-amber-50 dark:bg-amber-900/20 text-sm">
          Removed from Events: members don&apos;t see it in Events, search or their calendar feed.
          {hubSession ? "" : " The calendar sync leaves it removed."}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={save}>
        <div className="@container">
          <dl className="grid grid-cols-1 @pair:grid-cols-2 gap-4 text-sm">
            {(scheduleForm || event.title) && (
              <Field label="Title" extra={form && <>{edited(overridden.title)}{followAgain(overridden.title, () => set({ title: "" }))}</>} htmlFor="event-title" wide>
                {scheduleForm ? (
                  <input id="event-title" type="text" value={scheduleForm.title} required={hubSession} onChange={(e) => set({ title: e.target.value })} className={INPUT} />
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
            {timesForm ? (
              <>
                <Field label="Starts" htmlFor="event-starts">
                  <input id="event-starts" type="date" value={timesForm.starts_at} required onChange={(e) => set({ starts_at: e.target.value })} className={INPUT} />
                </Field>
                <Field label="Ends" htmlFor="event-ends">
                  <input id="event-ends" type="date" value={timesForm.ends_at} required onChange={(e) => set({ ends_at: e.target.value })} className={INPUT} />
                </Field>
                <Field label="Start time" htmlFor="event-start-clock">
                  <input id="event-start-clock" type="time" value={timesForm.start_clock} onChange={(e) => set({ start_clock: e.target.value })} className={INPUT} />
                </Field>
                <Field label="End time" htmlFor="event-end-clock">
                  <input id="event-end-clock" type="time" value={timesForm.end_clock} onChange={(e) => set({ end_clock: e.target.value })} className={INPUT} />
                </Field>
                <p className="@pair:col-span-2 -mt-2 text-xs text-slate-600 dark:text-slate-400">Eastern time. Leave both times empty for an all-day event.</p>
              </>
            ) : (
              <>
                <Field label="Dates">
                  {formatDateOnly(event.starts_at)} – {formatDateOnly(event.ends_at)}
                </Field>
                {when.startClock && (
                  <Field label="Time">
                    {when.startClock} – {when.endClock} Eastern
                  </Field>
                )}
                {form && <p className="@pair:col-span-2 -mt-2 text-xs text-slate-600 dark:text-slate-400">The dates and times come from Google Calendar and can&apos;t be changed here yet.</p>}
              </>
            )}
            {(scheduleForm || event.host_name) && (
              <Field label="Host" htmlFor="event-host">
                {scheduleForm && !hubSession ? (
                  <MemberSearch
                    members={members}
                    selectedMemberId={scheduleForm.host_id}
                    selectedMemberName={scheduleForm.host_name}
                    onSelect={(member) => set({ host_id: member?.id ?? null, host_name: member ? member.displayName?.trim() || member.name : null })}
                    placeholder="Search for the host..."
                  />
                ) : scheduleForm ? (
                  <input id="event-host" type="text" value={scheduleForm.host_name ?? ""} onChange={(e) => set({ host_name: e.target.value || null })} className={INPUT} />
                ) : (
                  event.host_name
                )}
              </Field>
            )}
            {(scheduleForm || event.location) && (
              <Field label="Location" extra={form && <>{edited(overridden.location)}{followAgain(overridden.location, () => set({ location: null }))}</>} htmlFor="event-location">
                {scheduleForm ? (
                  <input id="event-location" type="text" value={scheduleForm.location ?? ""} onChange={(e) => set({ location: e.target.value || null })} className={INPUT} />
                ) : (
                  event.location
                )}
              </Field>
            )}
            {form ? (
              <div className="@pair:col-span-2">
                <EventAudienceFields
                  value={form}
                  onChange={(audience) => set(audience)}
                  speakersExtra={
                    <>
                      {edited(overridden.guestSpeaker)}
                      {followAgain(overridden.guestSpeaker, () => set({ speakers: null }))}
                    </>
                  }
                />
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
            {(scheduleForm || event.description) && (
              <Field label="Description" extra={form && <>{edited(overridden.description)}{followAgain(overridden.description, () => set({ description: null }))}</>} htmlFor="event-description" wide>
                {scheduleForm ? (
                  <textarea id="event-description" rows={2} value={scheduleForm.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} className={INPUT} />
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
