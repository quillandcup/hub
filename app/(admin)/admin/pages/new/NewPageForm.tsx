"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LandingPageType } from "@/lib/data/landing-pages";
import { PROMPT_MAX } from "@/lib/landing/ai-limits";
import { slugify } from "@/lib/landing/slug";
import { LANDING_STARTERS, STARTER_KEYS, isStarterKey } from "@/lib/landing/starters";
import { createLandingPage, createLandingPageWithAi } from "../actions";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

export type TemplateChoice = { id: string; name: string; pageType: LandingPageType };

export default function NewPageForm({ aiAvailable, defaultType = "website", templates = [] }: { aiAvailable: boolean; defaultType?: LandingPageType; templates?: TemplateChoice[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pageType, setPageType] = useState<LandingPageType>(defaultType);
  const [starter, setStarter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Only starting points for the chosen kind are offered; changing the kind drops a choice that no longer fits.
  const starterKeys = STARTER_KEYS.filter((key) => LANDING_STARTERS[key].pageType === pageType);
  const choices = templates.filter((t) => t.pageType === pageType);
  const template = choices.find((t) => t.id === starter);
  const useAi = !starter && Boolean(prompt.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = useAi ? await createLandingPageWithAi({ title, slug, prompt, pageType }) : await createLandingPage(template ? { title, slug, template: template.id, pageType } : { title, slug, starter: starter || undefined, pageType });
          if (result.error || !result.slug) return setError(result.error ?? "Couldn't create the page.");
          router.push(`/admin/pages/${result.slug}`);
        });
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="text-sm font-medium">Kind of page</legend>
        {(
          [
            ["website", "Website page", "Shares the site's header, footer and style with the other website pages (home, about, ...)."],
            ["landing", "Landing page", "Stands alone, for one purpose such as a sign-up or a campaign. Styled on its own."],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="pageType"
              value={value}
              checked={pageType === value}
              onChange={() => {
                setPageType(value);
                setStarter("");
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
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
        Start from
        <select
          value={starter}
          onChange={(e) => {
            const next = e.target.value;
            setStarter(next);
            const chosen = choices.find((t) => t.id === next);
            if (chosen && !title.trim()) setTitle(chosen.name);
            if (isStarterKey(next)) {
              if (!title.trim()) setTitle(LANDING_STARTERS[next].title);
              if (!edited && !slug) setSlug(LANDING_STARTERS[next].slug);
            }
          }}
          className={`${INPUT} mt-1`}
        >
          <option value="">A blank page</option>
          {starterKeys.length > 0 && (
            <optgroup label="Built in">
              {starterKeys.map((key) => (
                <option key={key} value={key}>
                  {LANDING_STARTERS[key].label}
                </option>
              ))}
            </optgroup>
          )}
          {choices.length > 0 && (
            <optgroup label="Templates">
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">
          {starter && isStarterKey(starter)
            ? `${LANDING_STARTERS[starter].description} It is saved as a draft for you to edit; nothing is published.`
            : template
              ? "A template you published. Its published copy is saved as a draft for you to edit; nothing is published."
              : "Or begin with a ready-made draft or one of your published templates."}
        </span>
      </label>
      <label className="block text-sm font-medium">
        Describe the page (optional)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          maxLength={PROMPT_MAX}
          disabled={!aiAvailable || Boolean(starter)}
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
        {pending ? (useAi ? "Drafting the page… this can take a minute" : "Creating…") : useAi ? "Draft the page" : "Create page"}
      </button>
    </form>
  );
}
