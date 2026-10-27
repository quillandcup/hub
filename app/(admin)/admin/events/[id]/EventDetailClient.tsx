"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PhotoLightbox from "@/components/PhotoLightbox";
import MemberSearch from "@/components/MemberSearch";
import EventDetailsCard, { type EventData } from "./EventDetailsCard";

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
  memberRealName?: string;
  memberEmail: string;
}

interface BadgeTypeLink {
  id: string;
  name: string;
  icon: string;
}

export default function EventDetailClient({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [badgeType, setBadgeType] = useState<BadgeTypeLink | null>(null);
  // The prickle this event stands for, when it has one: the source of its title, description, guest speaker and host.
  const [prickleId, setPrickleId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reverting, setReverting] = useState(false);
  const [changingVisibility, setChangingVisibility] = useState(false);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [addingMember, setAddingMember] = useState<Member | null>(null);
  const [addingAttendee, setAddingAttendee] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/events/${eventId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to fetch event");
      setEvent(body.event);
      setPhotos(body.photos);
      setBadgeType(body.badgeType);
      setPrickleId(body.prickleId ?? null);
      setAttendees(body.attendees);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


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

  /** Saves the card's form; returns an error message for the card to show, or null when it saved. */
  const saveEvent = async (form: EventData): Promise<string | null> => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save event");
      setEvent(body.event);
      return null;
    } catch (err: any) {
      return err.message as string;
    }
  };

  const setHidden = async (hidden: boolean) => {
    setError(null);
    setChangingVisibility(true);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to change whether the event is hidden");
      setEvent(body.event);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChangingVisibility(false);
    }
  };

  const handleRevert = async () => {
    setError(null);
    setReverting(true);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/revert-to-calendar`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to follow the calendar again");
      setEvent(body.event);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReverting(false);
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

  if (loading) return <p className="text-slate-600 dark:text-slate-400">Loading...</p>;
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

      <EventDetailsCard
        event={event}
        prickleId={prickleId}
        onSave={saveEvent}
        onToggleRemoved={() => setHidden(!event.deleted_at)}
        removing={changingVisibility}
        onRevert={handleRevert}
        reverting={reverting}
      />

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
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
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
            className="px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm disabled:opacity-50"
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
                <span>
                  <Link
                    href={`/admin/members/${attendee.memberId}`}
                    className="text-sm font-medium text-plum-600 dark:text-plum-400 hover:underline"
                  >
                    {attendee.memberName}
                  </Link>
                  {attendee.memberRealName && (
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{attendee.memberRealName}</span>
                  )}
                </span>
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
            className="px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm"
          >
            Import Photos from Google Photos
          </a>
        </div>

        {visiblePhotos.length === 0 ? (
          <p className="text-gray-500">No photos imported yet.</p>
        ) : (
          <div className="@container">
            <div className="grid grid-cols-2 @pair:grid-cols-4 @cards:grid-cols-6 gap-2">
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
              <div className="@container">
                <div className="grid grid-cols-2 @pair:grid-cols-4 @cards:grid-cols-6 gap-2 mt-3">
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
