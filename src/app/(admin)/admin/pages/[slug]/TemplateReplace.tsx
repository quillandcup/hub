"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

/** A published template the draft can be replaced with (its key is the template's id). */
export type TemplateReplaceOption = { key: string; label: string; description: string };

/**
 * "Start over from a template" in the History dialog: replaces the draft with a published template's page. It asks first (danger tone), and says
 * what is kept: the current draft stays in History and comes back with Bring back, and nothing goes live. The editor does the
 * replacing (`onReplace` returns an error message, or null when it worked and the page is reloading).
 */
export default function TemplateReplace({ choices, onReplace }: { choices: TemplateReplaceOption[]; onReplace: (key: string) => Promise<string | null> }) {
  const [key, setKey] = useState(choices[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  if (choices.length === 0) return null;
  const chosen = choices.find((c) => c.key === key) ?? choices[0];

  async function replace() {
    setError(null);
    const ok = await ask({
      title: `Replace your draft with the ${chosen.label} template?`,
      body: `Your draft is replaced by the ${chosen.label} template's page. The draft you have now is kept in History as "Your draft before it was replaced", and you can bring it back. The live page, the title, the address and the search settings don't change, and nothing goes live.`,
      confirmLabel: "Replace draft",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => setError(await onReplace(chosen.key)));
  }

  return (
    <section aria-labelledby="template-replace-heading" className="mt-6 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id="template-replace-heading" className="text-sm font-semibold">
        Start over from a template
      </h3>
      <p className="text-sm">Replaces your draft with one of your published templates. Your current draft is kept in History.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="template-replace-choice">
          Template
        </label>
        <select
          id="template-replace-choice"
          value={chosen.key}
          onChange={(e) => setKey(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => void replace()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          Replace draft with template
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
