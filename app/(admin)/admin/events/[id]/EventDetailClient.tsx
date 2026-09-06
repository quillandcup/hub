"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhotoLightbox from "@/components/PhotoLightbox";
import MemberSearch from "@/components/MemberSearch";

interface EventData {
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
}

interface Photo {
  id: string;
  hidden_at: string | null;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

interface Attendee {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
}

interface BadgeTypeLink {
  id: string;
  name: string;
  icon: string;
}

const EVENT_TYPES = [
  { value: "in_person_retreat", label: "In-Person Retreat" },
  { value: "virtual_retreat", label: "Virtual Retreat" },
  { value: "other", label: "Other" },
];

export default function EventDetailClient({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [badgeType, setBadgeType] = useState<BadgeTypeLink | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventData | null>(null);
  const [saving, setSaving] = useState(false);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [addingMember, setAddingMember] = useState<Member | null>(null);
  const [addingAttendee, setAddingAttendee] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [eventId]);

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/events/${eventId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to fetch event");
      setEvent(body.event);
      setPhotos(body.photos);
      setBadgeType(body.badgeType);
      setAttendees(body.attendees);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAttendee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingMember) return;
    setAddingAttendee(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/attendees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: addingMember.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to add attendee");
      setAddingMember(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingAttendee(false);
    }
  };

  const handleRemoveAttendee = async (memberId: string) => {
    setRemovingId(memberId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/attendees/${memberId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Failed to remove attendee");
      }
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  const startEdit = () => {
    if (!event) return;
    setEditForm(event);
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save event");
      setEvent(body.event);
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = async (photoId: string, hidden: boolean) => {
    setTogglingId(photoId);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Failed to update photo");
      }
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (!event) return <p className="text-red-600">{error || "Not found"}</p>;

  const visiblePhotos = photos.filter((p) => !p.hidden_at);
  const hiddenPhotos = photos.filter((p) => p.hidden_at);
  const lightboxPhotos = [...visiblePhotos, ...hiddenPhotos].map((p) => ({
    id: p.id,
    src: `/api/events/${eventId}/photos/${p.id}`,
  }));

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Metadata */}
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Details</h2>
          {!editing && (
            <button onClick={startEdit} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
              Edit
            </button>
          )}
        </div>

        {editing && editForm ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Type</label>
                <select
                  value={editForm.event_type}
                  onChange={(e) => setEditForm({ ...editForm, event_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Starts</label>
                <input
                  type="date"
                  value={editForm.starts_at}
                  onChange={(e) => setEditForm({ ...editForm, starts_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Ends</label>
                <input
                  type="date"
                  value={editForm.ends_at}
                  onChange={(e) => setEditForm({ ...editForm, ends_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Location</label>
                <input
                  type="text"
                  value={editForm.location ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value || null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Google Photos album link</label>
                <input
                  type="url"
                  value={editForm.google_photos_album_url ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, google_photos_album_url: e.target.value || null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">Focus</label>
              <input
                type="text"
                value={editForm.focus ?? ""}
                onChange={(e) => setEditForm({ ...editForm, focus: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">Description</label>
              <textarea
                value={editForm.description ?? ""}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">Agenda</label>
              <textarea
                value={editForm.agenda ?? ""}
                onChange={(e) => setEditForm({ ...editForm, agenda: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">Results</label>
              <textarea
                value={editForm.results ?? ""}
                onChange={(e) => setEditForm({ ...editForm, results: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Type</dt>
              <dd>{EVENT_TYPES.find((t) => t.value === event.event_type)?.label || event.event_type}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Dates</dt>
              <dd>
                {new Date(`${event.starts_at}T00:00:00`).toLocaleDateString()} –{" "}
                {new Date(`${event.ends_at}T00:00:00`).toLocaleDateString()}
              </dd>
            </div>
            {event.location && (
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Location</dt>
                <dd>{event.location}</dd>
              </div>
            )}
            {event.focus && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Focus</dt>
                <dd>{event.focus}</dd>
              </div>
            )}
            {event.description && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Description</dt>
                <dd className="whitespace-pre-wrap">{event.description}</dd>
              </div>
            )}
            {event.agenda && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Agenda</dt>
                <dd className="whitespace-pre-wrap">{event.agenda}</dd>
              </div>
            )}
            {event.results && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Results</dt>
                <dd className="whitespace-pre-wrap">{event.results}</dd>
              </div>
            )}
            {event.google_photos_album_url && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Google Photos album</dt>
                <dd>
                  <a
                    href={event.google_photos_album_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {event.google_photos_album_url}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {/* Attendees */}
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-1">Attendees ({attendees.length})</h2>
        {badgeType ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Adding or removing an attendee here also grants or revokes the linked{" "}
            <strong>
              {badgeType.icon} {badgeType.name}
            </strong>{" "}
            badge automatically.
          </p>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-500 mb-4">
            No badge is linked to this event yet -- attendance is just recorded here for now.
          </p>
        )}

        <form onSubmit={handleAddAttendee} className="flex items-start gap-2 mb-4">
          <div className="flex-1 max-w-sm">
            <MemberSearch
              members={allMembers}
              selectedMemberId={addingMember?.id ?? null}
              onSelect={setAddingMember}
              placeholder="Search by name or email..."
            />
          </div>
          <button
            type="submit"
            disabled={addingAttendee || !addingMember}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {addingAttendee ? "Adding..." : "Add attendee"}
          </button>
        </form>

        {attendees.length === 0 ? (
          <p className="text-gray-500">No attendees recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-slate-800">
            {attendees.map((attendee) => (
              <li key={attendee.id} className="flex items-center justify-between py-2">
                <Link
                  href={`/admin/members/${attendee.memberId}`}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {attendee.memberName}
                </Link>
                <button
                  onClick={() => handleRemoveAttendee(attendee.memberId)}
                  disabled={removingId === attendee.memberId}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  {removingId === attendee.memberId ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Photos */}
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Photos ({visiblePhotos.length})</h2>
          <a
            href={`/api/oauth/google/start?eventId=${eventId}`}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Import Photos from Google Photos
          </a>
        </div>

        {visiblePhotos.length === 0 ? (
          <p className="text-gray-500">No photos imported yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {visiblePhotos.map((photo, i) => (
              <div key={photo.id} className="relative group aspect-square">
                <button onClick={() => setLightboxIndex(i)} className="w-full h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route */}
                  <img
                    src={`/api/events/${eventId}/photos/${photo.id}`}
                    alt=""
                    className="w-full h-full object-cover rounded"
                  />
                </button>
                <button
                  onClick={() => toggleHidden(photo.id, true)}
                  disabled={togglingId === photo.id}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 bg-black/60 text-white text-xs rounded disabled:opacity-50"
                >
                  Hide
                </button>
              </div>
            ))}
          </div>
        )}

        {hiddenPhotos.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
            >
              {showHidden ? "▾" : "▸"} Hidden photos ({hiddenPhotos.length})
            </button>
            {showHidden && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-3">
                {hiddenPhotos.map((photo, i) => (
                  <div key={photo.id} className="relative group aspect-square">
                    <button onClick={() => setLightboxIndex(visiblePhotos.length + i)} className="w-full h-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route */}
                      <img
                        src={`/api/events/${eventId}/photos/${photo.id}`}
                        alt=""
                        className="w-full h-full object-cover rounded opacity-50"
                      />
                    </button>
                    <button
                      onClick={() => toggleHidden(photo.id, false)}
                      disabled={togglingId === photo.id}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 bg-black/60 text-white text-xs rounded disabled:opacity-50"
                    >
                      Unhide
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <PhotoLightbox
        photos={lightboxPhotos}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
      />
    </div>
  );
}
