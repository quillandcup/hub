"use client";

import { useState, type KeyboardEvent } from "react";
import Pill from "@/components/Pill";
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
 * Free-form chips: type a tag and press Enter, Tab or comma (or paste a comma-separated list) to add
 * it. This is the one component for any field that asks for tags; don't use a comma-separated text
 * box. Backspace in the empty box removes the last one. Case-insensitive duplicates are ignored.
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
    if (e.key === "Tab" && !e.shiftKey && draft.trim()) {
      // Tab turns the typed text into a pill and stays here, so another tag can follow.
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Enter" || e.key === ",") {
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
        <Pill key={tag} removeLabel={`Remove ${tag}`} removeTrack="tag-input-change" onRemove={() => onChange(tags.filter((t) => t !== tag))}>
          {tag}
        </Pill>
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
