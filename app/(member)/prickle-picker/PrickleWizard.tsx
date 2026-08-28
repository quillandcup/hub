"use client";

import { useState } from "react";
import Link from "next/link";
import MultiMemberSearch from "@/components/MultiMemberSearch";
import { getWizardRecommendations, type WizardAnswers } from "./actions";
import type { PickerRecommendation, TimeOfDay, VibePreference, PurposePreference } from "@/lib/prickle-picker";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface PrickleWizardProps {
  members: Member[];
}

const WINDOW_OPTIONS: { label: string; days: number }[] = [
  { label: "Today", days: 1 },
  { label: "This week", days: 7 },
  { label: "Next 2 weeks", days: 14 },
];

const TIME_OF_DAY_OPTIONS: { label: string; value: TimeOfDay }[] = [
  { label: "Any time", value: "any" },
  { label: "Morning", value: "morning" },
  { label: "Afternoon", value: "afternoon" },
  { label: "Evening", value: "evening" },
  { label: "Late night", value: "late_night" },
];

const VIBE_OPTIONS: { label: string; value: VibePreference; hint: string }[] = [
  { label: "Any mood", value: "any", hint: "Surprise me" },
  { label: "Focused", value: "focused", hint: "Quiet, heads-down" },
  { label: "Balanced", value: "balanced", hint: "A mix of quiet and chatting" },
  { label: "Chatty", value: "chatty", hint: "Lively, social" },
];

const PURPOSE_OPTIONS: { label: string; value: PurposePreference; hint: string }[] = [
  { label: "Any purpose", value: "any", hint: "" },
  { label: "Writing", value: "writing", hint: "My own project" },
  { label: "Non-writing work", value: "work", hint: "Taxes, marketing, admin — bring your own task" },
  { label: "Just socializing", value: "social", hint: "Here to hang out" },
];

const TOTAL_STEPS = 4;

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              selected
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-400"
            }`}
            title={opt.hint || undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function VibeBadge({ vibe }: { vibe: PickerRecommendation["vibe"] }) {
  const styles: Record<string, string> = {
    focused: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
    balanced: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    chatty: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    unknown: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  const labels: Record<string, string> = {
    focused: "🤫 Focused",
    balanced: "🎯 Balanced",
    chatty: "💬 Chatty",
    unknown: "New / unrated",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${styles[vibe]}`}>
      {labels[vibe]}
    </span>
  );
}

function formatOccurrence(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function PrickleWizard({ members }: PrickleWizardProps) {
  const [step, setStep] = useState(0);
  const [windowDays, setWindowDays] = useState(7);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("any");
  const [vibe, setVibe] = useState<VibePreference>("any");
  const [purpose, setPurpose] = useState<PurposePreference>("any");
  const [withMemberIds, setWithMemberIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PickerRecommendation[] | null>(null);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    const answers: WizardAnswers = { windowDays, timeOfDay, vibe, purpose, withMemberIds };
    const result = await getWizardRecommendations(answers);

    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setResults(result.recommendations);
  }

  function startOver() {
    setStep(0);
    setResults(null);
    setError(null);
  }

  if (results) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {results.length > 0 ? "Here's what looks good 🦔" : "No matches this time"}
          </h2>
          <button
            onClick={startOver}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
          >
            Start over
          </button>
        </div>

        {results.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center text-slate-500 dark:text-slate-400">
            Nothing matched all of that in this window. Try widening the time range or easing up on a filter.
          </div>
        )}

        <div className="space-y-4">
          {results.map((rec) => (
            <div
              key={rec.seriesKey}
              className="bg-white dark:bg-slate-900 rounded-lg shadow p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100">{rec.typeName}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {rec.hostName ? `Hosted by ${rec.hostName} · ` : ""}
                    {rec.scheduleLabel}
                  </p>
                </div>
                <VibeBadge vibe={rec.vibe} />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                {rec.avgAttendance !== null && (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    Usually ~{Math.round(rec.avgAttendance)} attendee{Math.round(rec.avgAttendance) === 1 ? "" : "s"}
                  </span>
                )}
                {rec.coAttendanceRate !== null && (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {Math.round(rec.coAttendanceRate * 100)}% of the time, everyone you picked is there
                  </span>
                )}
                {rec.vibeNotes && (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    “{rec.vibeNotes}”
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {rec.occurrences.map((occ) => (
                  <Link
                    key={occ.id}
                    href={`/prickles/${occ.id}`}
                    className="px-3 py-1.5 rounded-lg text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    {formatOccurrence(occ.startTime, timezone)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= step ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">When works for you?</h2>
          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Time window</p>
            <ChipGroup
              options={WINDOW_OPTIONS.map((o) => ({ label: o.label, value: String(o.days) }))}
              value={String(windowDays)}
              onChange={(v) => setWindowDays(Number(v))}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Time of day</p>
            <ChipGroup options={TIME_OF_DAY_OPTIONS} value={timeOfDay} onChange={setTimeOfDay} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s the mood?</h2>
          <ChipGroup options={VIBE_OPTIONS} value={vibe} onChange={setVibe} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">What are you here for?</h2>
          <ChipGroup options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Anyone you&apos;re hoping to see there?
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Totally optional — skip if it doesn&apos;t matter.</p>
          <MultiMemberSearch
            members={members}
            selectedMemberIds={withMemberIds}
            onChange={setWithMemberIds}
            placeholder="Search for a hedgie..."
          />
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-0 disabled:pointer-events-none"
        >
          ← Back
        </button>
        {step < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? "Sniffing around..." : "Show me prickles 🦔"}
          </button>
        )}
      </div>

      <p className="text-xs text-center text-slate-400 dark:text-slate-500">
        <Link href="/calendar" className="hover:underline">
          Never mind, back to my calendar
        </Link>
      </p>
    </div>
  );
}
