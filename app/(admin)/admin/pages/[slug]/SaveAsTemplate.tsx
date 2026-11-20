"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import LifecycleButton from "@/components/LifecycleButton";
import Modal from "@/components/Modal";
import { lifecycleConfirm, lifecycleLabel } from "@/lib/lifecycle-actions";
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX, TEMPLATE_NOTE_MAX } from "@/lib/landing/templates";
import { saveLandingTemplate } from "../template-actions";

export type TemplateOption = { id: string; name: string; description: string; version: number };

const INPUT = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const DANGER = "rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50";

/**
 * "Save as template" in the History dialog (docs/LANDING_PAGES.md, "Templates"): keeps the page on screen as a template, either a new
 * one or the next version of an existing one. Overwriting asks first (danger tone) and says the old version is kept and can be
 * brought back. `getDraft` returns the page as the editor holds it, so what is typed and not yet autosaved is included; the page
 * itself is not changed and nothing is published.
 */
export default function SaveAsTemplate({ templates: initial, getDraft }: { templates: TemplateOption[]; getDraft: () => unknown }) {
  const [known, setKnown] = useState(initial);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "overwrite">("new");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [overwriteId, setOverwriteId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  const target = known.find((t) => t.id === overwriteId);

  function openDialog() {
    setError(null);
    setDone(null);
    setNote("");
    setOpen(true);
  }

  function chooseTarget(id: string) {
    setOverwriteId(id);
    setDescription(known.find((t) => t.id === id)?.description ?? "");
  }

  function switchMode(next: "new" | "overwrite") {
    setMode(next);
    setError(null);
    if (next === "overwrite") chooseTarget(overwriteId || known[0]?.id || "");
    else setDescription("");
  }

  async function submit() {
    setError(null);
    if (mode === "overwrite") {
      if (!target) return setError("Choose the template to overwrite.");
      const spec = lifecycleConfirm("overwrite", { noun: "template", title: target.name });
      if (spec && !(await ask(spec))) return;
    } else if (!name.trim()) {
      return setError("Give the template a name.");
    }
    start(async () => {
      const result = await saveLandingTemplate(getDraft(), mode === "overwrite" ? { overwriteId, description, note } : { name, description, note });
      if (result.error || !result.templateId || !result.version) return setError(result.error ?? "Couldn't save the template.");
      const savedName = result.name ?? name;
      setKnown((list) => [...list.filter((t) => t.id !== result.templateId), { id: result.templateId!, name: savedName, description: description.trim(), version: result.version! }].sort((a, b) => a.name.localeCompare(b.name)));
      setDone(`Saved as version ${result.version} of ${savedName}.`);
      setName("");
      setNote("");
    });
  }

  return (
    <section aria-labelledby="save-template-heading" className="mt-6 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id="save-template-heading" className="text-sm font-semibold">
        Save as a template
      </h3>
      <p className="text-sm">Keeps this page as a template to start other pages from. Saving over an existing template keeps its earlier versions, so you can bring one back.</p>
      <LifecycleButton action="saveAsTemplate" noun="page" withIcon onRun={openDialog} className={SECONDARY} />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={lifecycleLabel("saveAsTemplate")} maxWidth="lg">
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {done}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">The page itself is unchanged and nothing was published. Find the template under Pages, Templates.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={SECONDARY} onClick={() => setDone(null)}>
                Save another
              </button>
              <button type="button" className={PRIMARY} onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Where to save it</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-mode" checked={mode === "new"} onChange={() => switchMode("new")} />
                New template
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-mode" checked={mode === "overwrite"} disabled={known.length === 0} onChange={() => switchMode("overwrite")} />
                Overwrite an existing template
              </label>
            </fieldset>
            {mode === "new" ? (
              <label className="block text-sm font-medium">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={TEMPLATE_NAME_MAX} required className={INPUT} />
              </label>
            ) : (
              <label className="block text-sm font-medium">
                Template to overwrite
                <select value={overwriteId} onChange={(e) => chooseTarget(e.target.value)} className={INPUT}>
                  {known.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (version {t.version})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm font-medium">
              Description (optional)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={TEMPLATE_DESCRIPTION_MAX} className={INPUT} />
            </label>
            <label className="block text-sm font-medium">
              What changed? (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={TEMPLATE_NOTE_MAX} placeholder="Shown in the template's history" className={INPUT} />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={SECONDARY} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={pending} className={mode === "overwrite" ? DANGER : PRIMARY}>
                {pending ? "Saving…" : mode === "overwrite" ? lifecycleLabel("overwrite", "template") : lifecycleLabel("saveAsTemplate")}
              </button>
            </div>
          </form>
        )}
      </Modal>
      {dialog}
    </section>
  );
}
