"use client";

import { useState, type KeyboardEvent } from "react";
import { splitTopicInput } from "@/lib/ask-me-about";

interface TagInputProps {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  maxTagLength?: number;
}

/**
 * Free-form chips: type a tag and press Enter or comma (or paste a comma-separated list) to add
 * it; Backspace in the empty box removes the last one. Case-insensitive duplicates are ignored.
 * Text still in the box when the form submits is the caller's to pick up via `onChange` -- it's
 * committed on blur, so tabbing to "Save" doesn't lose it.
 */
export default function TagInput({ id, tags, onChange, placeholder, maxTags, maxTagLength }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function commit(text: string) {
    const incoming = splitTopicInput(text);
    if (incoming.length === 0) return;
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    const next = [...tags];
    for (const tag of incoming) {
      if (seen.has(tag.toLowerCase())) continue;
      if (maxTags !== undefined && next.length >= maxTags) break;
      seen.add(tag.toLowerCase());
      next.push(maxTagLength ? tag.slice(0, maxTagLength) : tag);
    }
    onChange(next);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      if (!draft.trim()) {
        // An empty Enter shouldn't submit the surrounding form by accident either.
        if (e.key === "Enter") e.preventDefault();
        return;
      }
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  const full = maxTags !== undefined && tags.length >= maxTags;

  return (
    <div className="flex flex-wrap items-center gap-1.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-plum-500/40">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 text-sm pl-2.5 pr-1 py-0.5"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`Remove ${tag}`}
            className="rounded-full w-4 h-4 leading-none text-xs hover:bg-plum-100 dark:hover:bg-plum-800"
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          // Pasted or typed commas split into tags right away.
          if (value.includes(",")) commit(value);
          else setDraft(value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={full ? "" : tags.length === 0 ? placeholder : "Add another…"}
        disabled={full}
        maxLength={maxTagLength ? maxTagLength + 20 : undefined}
        autoComplete="off"
        className="flex-1 min-w-[8rem] bg-transparent text-sm py-0.5 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
