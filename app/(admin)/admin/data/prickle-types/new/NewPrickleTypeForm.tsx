"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PrickleTypePurpose = "writing" | "work" | "social" | "mixed";

const PURPOSE_OPTIONS: { value: PrickleTypePurpose; label: string; hint: string }[] = [
  { value: "writing", label: "Writing", hint: "Default" },
  { value: "work", label: "Non-writing work", hint: "On-topic group work, e.g. goal review" },
  { value: "social", label: "Social", hint: "Hangout-focused" },
  { value: "mixed", label: "Mixed", hint: "A bit of everything" },
];

export default function NewPrickleTypeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState<PrickleTypePurpose>("writing");
  const [soloTaskFriendly, setSoloTaskFriendly] = useState(true);
  const [listedInEvents, setListedInEvents] = useState(false);
  const [announcedPublicly, setAnnouncedPublicly] = useState(false);
  const [guestsAllowed, setGuestsAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview the normalized name as user types
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/prickle-types/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          purpose,
          soloTaskFriendly,
          listedInEvents,
          announcedPublicly,
          guestsAllowed,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create prickle type");
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
      <h2 className="text-xl font-bold mb-6">New Prickle Type</h2>

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
          {name && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Normalized name: <span className="font-mono">{normalizedName || "(empty)"}</span>
            </p>
          )}
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
            (Craft & Chat).
          </p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={listedInEvents}
              onChange={(e) => setListedInEvents(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Listed in Events
          </label>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Show upcoming prickles of this type on the member Events page (webinars, Hedgies on First, Monthly Goal Review, pitches). Leave off for everyday progress and sprint prickles.
          </p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={announcedPublicly}
              onChange={(e) => setAnnouncedPublicly(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Announced publicly
          </label>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Include in public marketing. Not used by any page yet.
          </p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={guestsAllowed}
              onChange={(e) => setGuestsAllowed(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Guests allowed
          </label>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Non-members may attend. Not used by any page yet.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? "Creating..." : "Create Prickle Type"}
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
