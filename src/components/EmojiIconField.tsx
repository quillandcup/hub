"use client";

import { useState } from "react";
import EmojiPicker from "@/components/chat/EmojiPicker";
import { unicodeEmoji } from "@/lib/chat/emoji";
import { baseName, toneOf, tonedUnicode } from "@/lib/chat/skin-tone";

/**
 * A button showing the chosen emoji that opens the chat's emoji picker. `onChange` gets the
 * Unicode emoji itself (what an icon column stores), not the Slack shortcode.
 */
export default function EmojiIconField({
  value,
  onChange,
  label = "Icon",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  const pick = (name: string) => {
    const base = unicodeEmoji(baseName(name));
    if (!base) return;
    const tone = toneOf(name);
    onChange(tone ? tonedUnicode(base, tone) : base);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label}: ${value || "none"}. Change`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-20 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-center text-lg"
      >
        {value || "＋"}
      </button>
      {open && <EmojiPicker custom={{}} onPick={pick} onClose={() => setOpen(false)} />}
    </div>
  );
}
