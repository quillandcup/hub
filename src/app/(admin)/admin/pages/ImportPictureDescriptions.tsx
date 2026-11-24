"use client";

import { useEffect, useState } from "react";
import type { AltSuggestion, PictureSlot } from "@/lib/landing/kajabi-alt-text";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

/** What the dialog holds for one picture: the text in its field, whether it is marked decorative, where it came from and whether the admin changed it. */
export type PictureAlt = { alt: string; decorative: boolean; by: "ai" | "fallback"; edited: boolean };

export const initialAlts = (slots: PictureSlot[]): Record<string, PictureAlt> => Object.fromEntries(slots.map((s) => [s.id, { alt: s.fallback.alt, decorative: s.fallback.decorative, by: "fallback" as const, edited: false }]));

type Answer = { status: "suggested"; suggestions: AltSuggestion[]; ai: "used" | "not_set_up" | "failed" } | { status: "error"; error: string };

const WHY = {
  used: "Suggested by the AI from the headings near each picture. The pictures themselves are never sent anywhere.",
  not_set_up: "The AI isn't set up, so these are taken from the nearest heading.",
  failed: "The AI didn't answer, so these are taken from the nearest heading.",
  error: "Couldn't ask for suggestions, so these are taken from the nearest heading.",
} as const;

const ROLE_LABEL = { logo: "Logo", picture: "Picture", "side picture": "Picture beside text", "card picture": "Card picture" } as const;

/**
 * The pictures the export has no description for, each with an editable description (and a "decorative" switch where the block has one).
 * What is in the fields when the admin imports is what is written: nothing is applied unseen. The suggestions are asked for once, when this
 * opens, and never replace what the admin has already typed.
 */
export default function ImportPictureDescriptions({ file, slots, value, onChange }: { file: File; slots: PictureSlot[]; value: Record<string, PictureAlt>; onChange: (next: (current: Record<string, PictureAlt>) => Record<string, PictureAlt>) => void }) {
  const [why, setWhy] = useState<keyof typeof WHY | "asking">("asking");

  useEffect(() => {
    let live = true;
    void (async () => {
      let answer: Answer;
      try {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/admin/landing-pages/import/alt-text", { method: "POST", body });
        answer = (await response.json().catch(() => null)) as Answer;
      } catch {
        answer = { status: "error", error: "network" };
      }
      if (!live) return;
      if (!answer || answer.status !== "suggested") {
        setWhy("error");
        return;
      }
      setWhy(answer.ai);
      onChange((current) => {
        const next = { ...current };
        for (const s of answer.suggestions) if (next[s.id] && !next[s.id].edited) next[s.id] = { ...next[s.id], alt: s.alt, decorative: s.decorative, by: s.by };
        return next;
      });
    })();
    return () => {
      live = false;
    };
    // Asked once per file: the callback is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const set = (id: string, change: Partial<PictureAlt>) => onChange((current) => ({ ...current, [id]: { ...current[id], ...change, edited: true } }));

  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">Picture descriptions</legend>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {slots.length === 1 ? "A picture here has" : `${slots.length} pictures here have`} no description for people who can&apos;t see them (a page can&apos;t be published without one). Check each, change it if it is wrong, or mark the picture decorative. What is in these fields is written into the page.
      </p>
      <p role="status" className="text-xs text-slate-600 dark:text-slate-400">
        {why === "asking" ? "Asking for suggestions…" : WHY[why]}
      </p>
      <ul className="space-y-2">
        {slots.map((slot, index) => {
          const entry = value[slot.id];
          if (!entry) return null;
          return (
            <li key={slot.id} className="rounded border border-slate-200 p-2 dark:border-slate-700">
              <label className="block text-sm font-medium">
                {ROLE_LABEL[slot.role]} {index + 1}
                {slot.headings.length > 0 && <span className="font-normal text-slate-600 dark:text-slate-400"> near &ldquo;{slot.headings[0]}&rdquo;</span>}
                <input value={entry.decorative ? "" : entry.alt} disabled={entry.decorative} onChange={(e) => set(slot.id, { alt: e.target.value, by: entry.by })} maxLength={160} aria-label={`Description of ${ROLE_LABEL[slot.role].toLowerCase()} ${index + 1}`} className={`${INPUT} mt-1 font-normal`} />
              </label>
              {slot.canBeDecorative && (
                <label className="mt-1 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={entry.decorative} onChange={(e) => set(slot.id, { decorative: e.target.checked })} />
                  <span>Decorative: it adds nothing a reader needs</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
