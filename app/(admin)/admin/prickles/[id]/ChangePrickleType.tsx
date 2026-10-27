"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePrickleType } from "./actions";

/**
 * Admin-only: moves a calendar prickle to another type, for an event that was filed under the wrong one
 * on the Unmatched Calendar Events page. Stays after reprocessing (see changePrickleType).
 */
export default function ChangePrickleType({ prickleId, currentTypeId, types }: { prickleId: string; currentTypeId: string | null; types: { id: string; name: string }[] }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(currentTypeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await changePrickleType(prickleId, typeId);
      if ("error" in result) setError(result.error ?? "That didn't work");
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-1">Type</h2>
      {error && <p className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="prickle-type" className="sr-only">
          Prickle type
        </label>
        <select
          id="prickle-type"
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setSaved(false);
          }}
          className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !typeId || typeId === currentTypeId}
          onClick={save}
          className="px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Change type"}
        </button>
        {saved && <span className="text-slate-600 dark:text-slate-400">Saved.</span>}
      </div>
    </section>
  );
}
