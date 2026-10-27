"use client";

import { EVENT_TYPE_OPTIONS } from "@/lib/events-filter";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AudienceChecks from "@/components/AudienceChecks";
import MemberSearch from "@/components/MemberSearch";

type PrickleTypePurpose = "writing" | "work" | "social" | "mixed";

const PURPOSE_OPTIONS: { value: PrickleTypePurpose; label: string; hint: string }[] = [
  { value: "writing", label: "Writing", hint: "Default" },
  { value: "work", label: "Non-writing work", hint: "On-topic group work, e.g. goal review" },
  { value: "social", label: "Social", hint: "Hangout-focused" },
  { value: "mixed", label: "Mixed", hint: "A bit of everything" },
];

interface EditPrickleTypeFormProps {
  prickleType: {
    id: string;
    name: string;
    normalized_name: string;
    description: string | null;
    purpose: PrickleTypePurpose;
    solo_task_friendly: boolean;
    listed_in_events: boolean;
    announced_publicly: boolean;
    guests_allowed: boolean;
    event_kind?: string;
    default_host_id?: string | null;
    summary_aliases?: string[];
    names_guest_speaker?: boolean;
  };
  /** Active members to pick the default host from. */
  members?: { id: string; name: string; email: string }[];
  defaultHostName?: string | null;
}

export default function EditPrickleTypeForm({
  prickleType,
  members = [],
  defaultHostName = null,
}: EditPrickleTypeFormProps) {
  const router = useRouter();
  const [name, setName] = useState(prickleType.name);
  const [description, setDescription] = useState(prickleType.description || "");
  const [purpose, setPurpose] = useState<PrickleTypePurpose>(prickleType.purpose);
  const [soloTaskFriendly, setSoloTaskFriendly] = useState(prickleType.solo_task_friendly);
  const [listedInEvents, setListedInEvents] = useState(prickleType.listed_in_events);
  const [announcedPublicly, setAnnouncedPublicly] = useState(prickleType.announced_publicly);
  const [guestsAllowed, setGuestsAllowed] = useState(prickleType.guests_allowed);
  const [eventKind, setEventKind] = useState(prickleType.event_kind ?? "session");
  const [defaultHostId, setDefaultHostId] = useState<string | null>(prickleType.default_host_id ?? null);
  const [aliases, setAliases] = useState((prickleType.summary_aliases ?? []).join(", "));
  const [namesGuestSpeaker, setNamesGuestSpeaker] = useState(prickleType.names_guest_speaker ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/prickle-types/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId: prickleType.id,
          name: name.trim(),
          description: description.trim(),
          purpose,
          soloTaskFriendly,
          listedInEvents,
          announcedPublicly,
          guestsAllowed,
          eventKind,
          defaultHostId,
          summaryAliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
          namesGuestSpeaker,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update prickle type");
      }

      // Success - redirect back to prickle types page
      router.push("/admin/data/prickle-types");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-6">Edit Prickle Type</h2>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Name */}
        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Progress Prickle, Workshop Prickle"
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            required
          />
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Current normalized name: <span className="font-mono">{prickleType.normalized_name}</span>
          </p>
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this prickle type..."
            rows={4}
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Purpose */}
        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Purpose
          </label>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as PrickleTypePurpose)}
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            {PURPOSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} — {opt.hint}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Used by the Prickle Picker to filter recommendations by purpose.
          </p>
        </div>

        {/* Solo-task friendliness */}
        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={soloTaskFriendly}
              onChange={(e) => setSoloTaskFriendly(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Good for bring-your-own-task time
          </label>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Can a hedgie zone out on an unrelated task (especially non-writing work) here? Turn this off for
            structured/participatory sessions (workshops, sprints, pitches, educational) and very chatty ones
            (Craft & Chat) — being writing-purpose doesn&apos;t automatically make a slot friendly for this.
          </p>
        </div>

        <AudienceChecks
          value={{ listed: listedInEvents, publicly: announcedPublicly, guests: guestsAllowed }}
          onChange={(next) => {
            setListedInEvents(next.listed);
            setAnnouncedPublicly(next.publicly);
            setGuestsAllowed(next.guests);
          }}
        />

        <div className="mb-6">
          <label htmlFor="event-kind" className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Event kind</label>
          <select
            id="event-kind"
            value={eventKind}
            onChange={(e) => setEventKind(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
          >
            {EVENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            What an event made from a prickle of this type starts as, which decides where the Events page lists it (a session, educational, social...).
          </p>
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Default host</label>
          <MemberSearch
            members={members}
            selectedMemberId={defaultHostId}
            selectedMemberName={defaultHostName}
            onSelect={(member) => setDefaultHostId(member?.id ?? null)}
          />
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Hosts prickles of this type that name nobody. Saving rebuilds this type&apos;s prickles from the calendar.
          </p>
        </div>

        <div className="mb-6">
          <label htmlFor="summary-aliases" className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Other names
          </label>
          <input
            id="summary-aliases"
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="e.g., edu"
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Comma-separated. A calendar title that starts with one of these (&quot;EDU-PRICKLE: Make It Funny&quot;) is this type.
          </p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={namesGuestSpeaker}
              onChange={(e) => setNamesGuestSpeaker(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Name after &quot;w/&quot; is the guest speaker
          </label>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            The default host hosts and the name on the calendar title is shown as the guest speaker.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/data/prickle-types")}
            disabled={loading}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:bg-slate-300 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
