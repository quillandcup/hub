"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ConfirmDialog";
import LifecycleButton from "@/components/LifecycleButton";
import Modal from "@/components/Modal";
import { lifecycleConfirm, lifecycleLabel } from "@/lib/lifecycle-actions";
import { TEMPLATE_NAME_MAX } from "@/lib/landing/templates";
import { saveLandingTemplate } from "../template-actions";

export type TemplateOption = { id: string; name: string; published: boolean };

const INPUT = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const DANGER = "rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50";

/**
 * "Save as template" in the History dialog (docs/product/LANDING_PAGES.md, "Templates"). A template is a page of its own kind, so this copies the
 * page on screen into one: **a new template** (its draft is this page; edit and publish it like any page), or **replace a template's
 * draft** with this page (asks first: the template's previous draft is kept in its History, and its published copy doesn't change).
 * "Publish the template now" does the publish in the same step (a new version; the template rules apply: nothing public). The page
 * itself is never changed. `getDraft` returns the page as the editor holds it, so what is typed and not yet autosaved is included.
 */
export default function SaveAsTemplate({ templates: initial, getDraft, pageId }: { templates: TemplateOption[]; getDraft: () => unknown; pageId: string }) {
  const [known, setKnown] = useState(initial);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [name, setName] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [publish, setPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; slug: string } | null>(null);
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  const target = known.find((t) => t.id === replaceId);

  function openDialog() {
    setError(null);
    setDone(null);
    setOpen(true);
  }

  function switchMode(next: "new" | "replace") {
    setMode(next);
    setError(null);
    if (next === "replace" && !replaceId) setReplaceId(known[0]?.id ?? "");
  }

  async function submit() {
    setError(null);
    if (mode === "replace") {
      if (!target) return setError("Choose the template whose draft to replace.");
      const spec = lifecycleConfirm("replaceTemplate", {
        noun: "template",
        title: target.name,
        detail: `“${target.name}” keeps its current draft in its History, and you can bring it back. ${publish ? "The template is published right after, so its published copy changes." : "Its published copy doesn't change until you publish it."}`,
      });
      if (spec && !(await ask(spec))) return;
    } else if (!name.trim()) {
      return setError("Give the template a name.");
    }
    start(async () => {
      const result = await saveLandingTemplate(getDraft(), mode === "replace" ? { replaceId, publish, fromPageId: pageId } : { name, publish, fromPageId: pageId });
      if (result.error || !result.templateId || !result.slug) return setError(result.error ?? "Couldn't save the template.");
      const savedName = result.name ?? name;
      setKnown((list) => [...list.filter((t) => t.id !== result.templateId), { id: result.templateId!, name: savedName, published: Boolean(result.published) || Boolean(list.find((t) => t.id === result.templateId)?.published) }].sort((a, b) => a.name.localeCompare(b.name)));
      setDone({
        message: mode === "replace" ? `Replaced the draft of “${savedName}”${result.published ? " and published it" : ""}.` : `Saved as the template “${savedName}”${result.published ? " and published it" : ": it is a draft until you publish it"}.`,
        slug: result.slug,
      });
      setName("");
    });
  }

  return (
    <section aria-labelledby="save-template-heading" className="mt-6 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id="save-template-heading" className="text-sm font-semibold">
        Save as a template
      </h3>
      <p className="text-sm">Copies this page into a template to start other pages from. The page itself isn&apos;t changed, and nothing is published unless you ask.</p>
      <LifecycleButton action="saveAsTemplate" noun="page" withIcon onRun={openDialog} className={SECONDARY} />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={lifecycleLabel("saveAsTemplate")} maxWidth="lg">
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {done.message}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Open it from{" "}
              <Link href={`/admin/pages/${done.slug}`} className="text-plum-700 underline dark:text-plum-300">
                the template&apos;s editor
              </Link>{" "}
              or under Pages, Templates.
            </p>
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
                New template from this page
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-mode" checked={mode === "replace"} disabled={known.length === 0} onChange={() => switchMode("replace")} />
                Replace a template&apos;s draft with this page
              </label>
            </fieldset>
            {mode === "new" ? (
              <label className="block text-sm font-medium">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={TEMPLATE_NAME_MAX} required className={INPUT} />
              </label>
            ) : (
              <label className="block text-sm font-medium">
                Template whose draft to replace
                <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)} className={INPUT}>
                  {known.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.published ? "" : " (not published)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              Publish the template now
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
              <button type="submit" disabled={pending} className={mode === "replace" ? DANGER : PRIMARY}>
                {pending ? "Saving…" : mode === "replace" ? lifecycleLabel("replaceTemplate") : lifecycleLabel("saveAsTemplate")}
              </button>
            </div>
          </form>
        )}
      </Modal>
      {dialog}
    </section>
  );
}
