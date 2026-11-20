"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

/** `group` "template" is a saved template (its key is the template's id); anything else is a built-in starter from code. */
export type StarterOption = { key: string; label: string; description: string; group?: "template" };

/**
 * "Start over from a starter" in the History dialog: replaces the draft with a starter's page. It asks first (danger tone), and says
 * what is kept: the current draft stays in History and comes back with Bring back, and nothing goes live. The editor does the
 * replacing (`onReplace` returns an error message, or null when it worked and the page is reloading).
 */
export default function StarterReplace({ starters, onReplace }: { starters: StarterOption[]; onReplace: (key: string) => Promise<string | null> }) {
  const [key, setKey] = useState(starters[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  if (starters.length === 0) return null;
  const chosen = starters.find((s) => s.key === key) ?? starters[0];
  const kind = chosen.group === "template" ? "template" : "starter";
  const builtIn = starters.filter((s) => s.group !== "template");
  const saved = starters.filter((s) => s.group === "template");

  async function replace() {
    setError(null);
    const ok = await ask({
      title: `Replace your draft with the ${chosen.label} ${kind}?`,
      body: `Your draft is replaced by the ${chosen.label} ${kind}'s page. The draft you have now is kept in History as "Your draft before it was replaced", and you can bring it back. The live page, the title, the address and the search settings don't change, and nothing goes live.`,
      confirmLabel: "Replace draft",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => setError(await onReplace(chosen.key)));
  }

  return (
    <section aria-labelledby="starter-replace-heading" className="mt-6 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id="starter-replace-heading" className="text-sm font-semibold">
        Start over from a starter{saved.length > 0 ? " or template" : ""}
      </h3>
      <p className="text-sm">Replaces your draft with a ready-made page{saved.length > 0 ? " or one of your saved templates" : ""}. Your current draft is kept in History.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="starter-replace-choice">
          Starter
        </label>
        <select
          id="starter-replace-choice"
          value={chosen.key}
          onChange={(e) => setKey(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {saved.length === 0 ? (
            builtIn.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))
          ) : (
            <>
              {builtIn.length > 0 && (
                <optgroup label="Built in">
                  {builtIn.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Saved templates">
                {saved.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => void replace()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          Replace draft with {kind}
        </button>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{chosen.description}</p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {dialog}
    </section>
  );
}
