"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { LandingPageType } from "@/lib/data/landing-pages";
import { slugify } from "@/lib/landing/slug";
import { createLandingPage } from "./actions";
import type { TemplateChoice } from "./new/NewPageForm";
import PageNameFields from "./PageNameFields";

const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const SECONDARY = "rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800";

const KIND_LABEL: Record<LandingPageType, string> = { website: "Website page", landing: "Landing page" };

/**
 * "New page" > "Start from a template": pick one of the published templates, name the page, and it opens in the editor as a draft
 * made from the template's published copy (`createLandingPage` with `template`). The page is the template's kind.
 */
export default function StartFromTemplateDialog({ isOpen, onClose, templates }: { isOpen: boolean; onClose: () => void; templates: TemplateChoice[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const template = templates.find((t) => t.id === choice);

  const close = () => {
    if (pending) return;
    setChoice("");
    setTitle("");
    setSlug("");
    setEdited(false);
    setError(null);
    onClose();
  };

  function pick(next: TemplateChoice) {
    setChoice(next.id);
    // The page takes the template's name until a title is typed.
    if (!title.trim() || title === template?.name) {
      setTitle(next.name);
      if (!edited) setSlug(slugify(next.name));
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Start from a template" maxWidth="lg">
      {templates.length === 0 ? (
        <div className="space-y-4 text-sm">
          <p>There are no published templates yet. A template is a page you keep to start other pages from; publish one and it is listed here.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={SECONDARY}>
              Close
            </button>
            <Link href="/admin/pages/templates" className={PRIMARY}>
              Go to Templates
            </Link>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!template) return setError("Choose a template.");
            setError(null);
            start(async () => {
              const result = await createLandingPage({ title, slug, template: template.id, pageType: template.pageType });
              if (result.error || !result.slug) return setError(result.error ?? "Couldn't create the page.");
              router.push(`/admin/pages/${result.slug}`);
            });
          }}
          className="max-h-[70vh] space-y-4 overflow-y-auto text-sm"
        >
          <p>The page starts as a draft copy of the template&apos;s published version. Nothing goes live until you publish it.</p>
          <fieldset>
            <legend className="font-medium">Template</legend>
            <div className="mt-1 space-y-1">
              {templates.map((t) => (
                <label key={t.id} className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <input type="radio" name="template" value={t.id} checked={choice === t.id} onChange={() => pick(t)} className="mt-1" />
                  <span>
                    <span className="font-medium">{t.name}</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{KIND_LABEL[t.pageType]}</span>
                  </span>
                </label>
              ))}
            </div>
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
          {error && (
            <p role="alert" className="text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={pending} className={SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !template || !title.trim()} className={PRIMARY}>
              {pending ? "Creating…" : "Create page"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
