"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCESS_OPTIONS, optionIndexFor } from "@/lib/courses/access-options";

/**
 * A published course's access length and launch date. Saving re-runs the course processing with
 * both, which rebuilds who has access (early buyers' access starts at the launch date).
 */
export default function CourseSettingsForm({
  slug,
  accessDuration,
  launchOn,
}: {
  slug: string;
  /** As stored (ISO 8601, e.g. "P1Y"), null = lifetime. */
  accessDuration: string | null;
  /** The launch day (YYYY-MM-DD in the organisation's timezone), or "". */
  launchOn: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(String(optionIndexFor(accessDuration)));
  const [launch, setLaunch] = useState(launchOn);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const option = ACCESS_OPTIONS[Number(choice)];
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/process/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: slug, accessDuration: option.value, launchOn: launch || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save");
      const done = data.courses?.[0];
      setMessage({ ok: true, text: done ? `Saved. ${done.access.members} members have access.` : "Saved." });
      router.refresh();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-4">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Access length</span>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
        >
          {optionIndexFor(accessDuration) === -1 && (
            <option value="-1" disabled>
              {accessDuration} (custom)
            </option>
          )}
          {ACCESS_OPTIONS.map((o, i) => (
            <option key={o.label} value={i}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Opens (optional)</span>
        <input
          type="date"
          value={launch}
          onChange={(e) => setLaunch(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
        />
      </label>
      <button
        type="submit"
        disabled={busy || choice === "-1"}
        className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-red-700 dark:text-red-300"}`}>
          {message.text}
        </p>
      )}
      <p className="basis-full text-xs text-slate-500 dark:text-slate-400">
        Anyone who bought before the opening date gets access starting that day, and their access length runs from then.
      </p>
    </form>
  );
}
