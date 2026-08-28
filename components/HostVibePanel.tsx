"use client";

import { useState } from "react";
import { saveHostVibe } from "@/app/(member)/prickle-picker/actions";
import type { Vibe } from "@/lib/prickle-picker";

interface HostedVibeInfo {
  typeId: string;
  typeName: string;
  vibe: Vibe;
  notes: string;
}

const VIBE_OPTIONS: { value: Vibe; label: string }[] = [
  { value: "focused", label: "🤫 Focused" },
  { value: "balanced", label: "🎯 Balanced" },
  { value: "chatty", label: "💬 Chatty" },
];

function HostedTypeRow({ initial }: { initial: HostedVibeInfo }) {
  const [vibe, setVibe] = useState<Vibe>(initial.vibe);
  const [notes, setNotes] = useState(initial.notes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = vibe !== initial.vibe || notes !== initial.notes;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await saveHostVibe(initial.typeId, vibe, notes);

    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">{initial.typeName}</h3>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {VIBE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setVibe(opt.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              vibe === opt.value
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything hedgies should know before they join? e.g. 'we check in on goals before writing'"
        rows={2}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
      />

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || saving}
        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export default function HostVibePanel({ hostedVibes }: { hostedVibes: HostedVibeInfo[] }) {
  if (hostedVibes.length === 0) return null;

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
      <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">My Prickle Vibe</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Help hedgies know what to expect from the prickles you host — this powers the Prickle Picker.
      </p>
      <div className="space-y-4">
        {hostedVibes.map((h) => (
          <HostedTypeRow key={h.typeId} initial={h} />
        ))}
      </div>
    </div>
  );
}
