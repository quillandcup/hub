"use client";

import { Bold, Code, Italic, List, ListOrdered, Quote, SquareCode, Strikethrough, type LucideIcon } from "lucide-react";
import type { FormatKind } from "@/lib/chat/format-text";

const BUTTONS: { kind: FormatKind; label: string; hint?: string; Icon: LucideIcon }[] = [
  { kind: "bold", label: "Bold", hint: "Ctrl+B", Icon: Bold },
  { kind: "italic", label: "Italic", hint: "Ctrl+I", Icon: Italic },
  { kind: "strike", label: "Strikethrough", hint: "Ctrl+Shift+X", Icon: Strikethrough },
  { kind: "bullets", label: "Bulleted list", Icon: List },
  { kind: "numbers", label: "Numbered list", Icon: ListOrdered },
  { kind: "quote", label: "Quote", Icon: Quote },
  { kind: "code", label: "Code", Icon: Code },
  { kind: "codeblock", label: "Code block", Icon: SquareCode },
];

/**
 * The row of formatting buttons over a message box. Each one writes its markers into the text around the
 * selection (see lib/chat/format-text.ts). The buttons never take focus from the box, so the selection stays.
 */
export default function FormatToolbar({ onFormat, disabled }: { onFormat: (kind: FormatKind) => void; disabled?: boolean }) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto px-2 pt-1.5">
      {BUTTONS.map(({ kind, label, hint, Icon }) => (
        <button
          key={kind}
          type="button"
          aria-label={label}
          title={hint ? `${label} (${hint})` : label}
          disabled={disabled}
          // mousedown, not click: the box would lose its selection before a click lands.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormat(kind)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
