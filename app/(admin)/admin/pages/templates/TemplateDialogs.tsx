"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { slugify } from "@/lib/landing/slug";
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX } from "@/lib/landing/templates";
import { createLandingPage } from "../actions";
import { updateLandingTemplateDetails } from "../template-actions";

const INPUT = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";

type Target = { id: string; name: string; description: string };

/** "Use": a new draft page from a template. The title and address are the page's own; the template's id never leaves the client and the server. */
export function UseTemplateDialog({ template, onClose }: { template: Target | null; onClose: () => void }) {
  return (
    <Modal isOpen={Boolean(template)} onClose={onClose} title={template ? `New page from ${template.name}` : "New page"} maxWidth="lg">
      {template && <UseForm key={template.id} template={template} onClose={onClose} />}
    </Modal>
  );
}

function UseForm({ template, onClose }: { template: Target; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(template.name);
  const [slug, setSlug] = useState(slugify(template.name));
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await createLandingPage({ title, slug, template: template.id });
          if (result.error || !result.slug) return setError(result.error ?? "Couldn't create the page.");
          router.push(`/admin/pages/${result.slug}`);
        });
      }}
    >
      <p className="text-sm text-slate-600 dark:text-slate-400">{template.description ? `${template.description} ` : ""}It is saved as a draft for you to edit; nothing is published.</p>
      <label className="block text-sm font-medium">
        Title
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!edited) setSlug(slugify(e.target.value));
          }}
          required
          className={INPUT}
        />
      </label>
      <label className="block text-sm font-medium">
        Address
        <span className="mt-1 flex items-center gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-400">/p/</span>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setEdited(true);
            }}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers and dashes"
            className={INPUT.replace("mt-1 ", "")}
          />
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={SECONDARY} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={pending || !title.trim()} className={PRIMARY}>
          {pending ? "Creating…" : "Create page"}
        </button>
      </div>
    </form>
  );
}

/** Rename a template or change its description. It is not a new version. */
export function RenameTemplateDialog({ template, onClose, onSaved }: { template: Target | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal isOpen={Boolean(template)} onClose={onClose} title="Rename template" maxWidth="lg">
      {template && <RenameForm key={template.id} template={template} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function RenameForm({ template, onClose, onSaved }: { template: Target; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await updateLandingTemplateDetails(template.id, { name, description });
          if (result.error) return setError(result.error);
          onSaved();
          onClose();
        });
      }}
    >
      <label className="block text-sm font-medium">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={TEMPLATE_NAME_MAX} required className={INPUT} />
      </label>
      <label className="block text-sm font-medium">
        Description (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={TEMPLATE_DESCRIPTION_MAX} className={INPUT} />
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-400">Renaming doesn&apos;t make a new version; the page inside is unchanged.</p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={SECONDARY} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={pending || !name.trim()} className={PRIMARY}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
