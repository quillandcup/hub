"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { LandingPageType } from "@/lib/data/landing-pages";
import { slugify } from "@/lib/landing/slug";
import { createLandingPageFromJson, type JsonImportSummary } from "./actions";
import JsonImportInput from "./JsonImportInput";
import PageNameFields from "./PageNameFields";

const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const SECONDARY = "rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800";

const KINDS: [LandingPageType, string, string][] = [
  ["website", "Website page", "Shares the site's header, footer and style with the other website pages."],
  ["landing", "Landing page", "Stands alone, for one purpose such as a sign-up or a campaign."],
];

/**
 * "New page" > "Import from JSON": a page exported from the builder (or written elsewhere), as a file or pasted text, becomes a new
 * draft. The file or text goes through the same section as the editor's import (`JsonImportInput`: a dry run first, then the
 * preview); only when the admin confirms is the page made, so something that can't be read leaves no page behind.
 */
export default function ImportJsonDialog({ isOpen, onClose, defaultType = "website" }: { isOpen: boolean; onClose: () => void; defaultType?: LandingPageType }) {
  const router = useRouter();
  const [ready, setReady] = useState<{ text: string; summary: JsonImportSummary } | null>(null);
  // Bumped on close so the import section starts clean next time.
  const [round, setRound] = useState(0);
  const [pageType, setPageType] = useState<LandingPageType>(defaultType);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    if (pending) return;
    setReady(null);
    setRound((n) => n + 1);
    setPageType(defaultType);
    setTitle("");
    setSlug("");
    setEdited(false);
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Import from JSON" maxWidth="2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          setError(null);
          start(async () => {
            const result = await createLandingPageFromJson({ text: ready.text, title, slug, pageType });
            if (result.error || !result.slug) return setError(result.error ?? "Couldn't create the page.");
            router.push(`/admin/pages/${result.slug}`);
          });
        }}
        className="max-h-[70vh] space-y-4 overflow-y-auto text-sm"
      >
        <p>Choose a page exported from the page builder (History, Download JSON), or paste its text. It becomes a new draft; nothing goes live until you publish it. You see what it holds before the page is made.</p>
        <JsonImportInput
          key={round}
          newPage
          disabled={pending}
          onPreview={(text) => createLandingPageFromJson({ text }, { dryRun: true })}
          onReady={(next) => {
            setReady(next);
            setError(null);
            // The page takes the file's title until one is typed.
            const fromFile = next?.summary.source?.title?.trim();
            if (fromFile && !title.trim()) {
              setTitle(fromFile);
              if (!edited) setSlug(slugify(fromFile));
            }
          }}
        />
        {ready && (
          <>
            <fieldset>
              <legend className="font-medium">Kind of page</legend>
              {KINDS.map(([value, label, hint]) => (
                <label key={value} className="mt-2 flex items-start gap-2">
                  <input type="radio" name="pageType" value={value} checked={pageType === value} onChange={() => setPageType(value)} className="mt-1" />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <PageNameFields
              title={title}
              slug={slug}
              edited={edited}
              onChange={(next) => {
                setTitle(next.title);
                setSlug(next.slug);
                setEdited(next.edited);
              }}
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} disabled={pending} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !ready || !title.trim()} className={PRIMARY}>
            {pending ? "Working…" : "Create page"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
