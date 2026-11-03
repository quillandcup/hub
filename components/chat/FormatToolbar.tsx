"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered, Quote, SquareCode, Strikethrough, Underline, type LucideIcon } from "lucide-react";
import type { FormatKind } from "@/lib/chat/format-text";

/** An address typed in the link box as a link address: `https://` added when it has no scheme, only web and mail addresses. */
export function linkAddress(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return ["http:", "https:", "mailto:"].includes(url.protocol) && (url.protocol === "mailto:" || url.hostname.includes(".")) ? withScheme : null;
  } catch {
    return null;
  }
}

const BUTTONS: { kind: FormatKind; label: string; hint?: string; Icon: LucideIcon; group: number }[] = [
  { kind: "bold", label: "Bold", hint: "Ctrl+B", Icon: Bold, group: 0 },
  { kind: "italic", label: "Italic", hint: "Ctrl+I", Icon: Italic, group: 0 },
  { kind: "underline", label: "Underline", hint: "Ctrl+U", Icon: Underline, group: 0 },
  { kind: "strike", label: "Strikethrough", hint: "Ctrl+Shift+X", Icon: Strikethrough, group: 0 },
  { kind: "link", label: "Link", Icon: LinkIcon, group: 1 },
  { kind: "numbers", label: "Numbered list", Icon: ListOrdered, group: 2 },
  { kind: "bullets", label: "Bulleted list", Icon: List, group: 2 },
  { kind: "quote", label: "Quote", Icon: Quote, group: 3 },
  { kind: "code", label: "Code", Icon: Code, group: 3 },
  { kind: "codeblock", label: "Code block", Icon: SquareCode, group: 3 },
];

/**
 * The row of formatting buttons over a message box, lit while the caret is in that format. They act on the editor's
 * selection and never take focus from it. Link opens a small address box (or removes the link the caret is in).
 */
export default function FormatToolbar({ editor, onFormat }: { editor: Editor; onFormat: (kind: FormatKind) => void }) {
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("code"),
      codeblock: e.isActive("codeBlock"),
    }),
  });

  const run = (kind: FormatKind) => {
    onFormat(kind);
    const chain = editor.chain().focus();
    if (kind === "bold") chain.toggleBold().run();
    else if (kind === "italic") chain.toggleItalic().run();
    else if (kind === "underline") chain.toggleUnderline().run();
    else if (kind === "strike") chain.toggleStrike().run();
    else if (kind === "bullets") chain.toggleBulletList().run();
    else if (kind === "numbers") chain.toggleOrderedList().run();
    else if (kind === "quote") chain.toggleBlockquote().run();
    else if (kind === "code") chain.toggleCode().run();
    else if (kind === "codeblock") chain.toggleCodeBlock().run();
    else if (active.link) chain.extendMarkRange("link").unsetLink().run();
    else {
      setAddress("");
      setInvalid(false);
      setLinking(true);
    }
  };

  const applyLink = () => {
    const href = linkAddress(address);
    if (!href) return setInvalid(true);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      chain.insertContent({ type: "text", text: href.replace(/^mailto:/i, ""), marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.extendMarkRange("link").setLink({ href }).run();
    setLinking(false);
  };

  return (
    <div>
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto px-2 pt-1.5">
        {BUTTONS.map(({ kind, label, hint, Icon, group }, i) => (
          <span key={kind} className="flex shrink-0 items-center">
            {i > 0 && BUTTONS[i - 1].group !== group && <span aria-hidden="true" className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />}
            <button
              type="button"
              aria-label={label}
              aria-pressed={active[kind]}
              title={hint ? `${label} (${hint})` : label}
              // mousedown, not click: the editor would lose its selection before a click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(kind)}
              className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 aria-pressed:bg-plum-50 aria-pressed:text-plum-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:aria-pressed:bg-plum-900/30 dark:aria-pressed:text-plum-300"
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      {linking && (
        <form
          className="flex items-center gap-2 px-2 pt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- it was just opened to be typed in
            autoFocus
            type="text"
            inputMode="url"
            aria-label="Link address"
            aria-invalid={invalid}
            placeholder="Link address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setLinking(false);
                editor.commands.focus();
              }
            }}
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm aria-invalid:border-red-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <button type="submit" className="rounded bg-plum-600 px-2 py-1 text-xs font-medium text-white hover:bg-plum-700">
            Add link
          </button>
          {invalid && (
            <span role="alert" className="text-xs text-red-600 dark:text-red-400">
              Enter a web or email address.
            </span>
          )}
        </form>
      )}
    </div>
  );
}
