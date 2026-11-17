"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PROMPT_MAX } from "@/lib/landing/ai-limits";
import { slugify } from "@/lib/landing/slug";
import { createLandingPage, createLandingPageWithAi } from "../actions";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

export default function NewPageForm({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await prompt.trim() ? await createLandingPageWithAi({ title, slug, prompt }) : await createLandingPage({ title, slug });
          if (result.error || !result.slug) return setError(result.error ?? "Couldn't create the page.");
          router.push(`/admin/pages/${result.slug}`);
        });
      }}
      className="space-y-4"
    >
      <label className="block text-sm font-medium">
        Title
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!edited) setSlug(slugify(e.target.value));
          }}
          required
          className={`${INPUT} mt-1`}
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
            className={INPUT}
          />
        </span>
      </label>
      <label className="block text-sm font-medium">
        Describe the page (optional)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          maxLength={PROMPT_MAX}
          disabled={!aiAvailable}
          placeholder={aiAvailable ? "Who it is for, what you offer, the dates and prices, and the link people should follow." : "Build with AI isn't set up yet."}
          className={`${INPUT} mt-1 disabled:opacity-60`}
        />
        <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">
          The assistant drafts the page from this description only; it is saved as a draft you read and edit before anything is published. Check every fact and link it wrote.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !title.trim()} className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50">
        {pending ? (prompt.trim() ? "Drafting the page… this can take a minute" : "Creating…") : prompt.trim() ? "Draft the page" : "Create page"}
      </button>
    </form>
  );
}
