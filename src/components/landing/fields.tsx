"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { documentNonce } from "@/lib/csp-nonce";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Link as LinkIcon, Link2Off, List, ListOrdered, Quote, type LucideIcon } from "lucide-react";
import { linkAddress } from "@/components/chat/FormatToolbar";
import MediaPicker from "@/components/media/MediaPicker";
import { ORG_TIMEZONE } from "@/lib/config";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/landing/countdown";
import Tooltip from "@/components/Tooltip";

/** Custom Puck fields for the page builder: the media library picker, rich text and a date in the organization's zone. */

const BUTTON =
  "flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100 aria-pressed:bg-plum-50 aria-pressed:text-plum-700 dark:text-slate-300 dark:hover:bg-slate-800";

function ToolbarButton({ label, Icon, active, disabled, onClick }: { label: string; Icon: LucideIcon; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    // mousedown, not click: the editor would lose its selection before a click lands.
    <Tooltip content={label}>
      <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={BUTTON}>
        <Icon size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 rounded-t border border-b-0 border-slate-300 bg-slate-50 px-2 py-1 dark:border-slate-600 dark:bg-slate-800/60">
      <select
        aria-label="Text style"
        value={state.style}
        onChange={(e) => (e.target.value === "p" ? run().setParagraph().run() : run().setHeading({ level: e.target.value === "h2" ? 2 : 3 }).run())}
        className="mr-1 rounded border border-slate-300 bg-white px-1 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <ToolbarButton label="Bold" Icon={Bold} active={state.bold} onClick={() => run().toggleBold().run()} />
      <ToolbarButton label="Italic" Icon={Italic} active={state.italic} onClick={() => run().toggleItalic().run()} />
      <ToolbarButton label="Bulleted list" Icon={List} active={state.bullets} onClick={() => run().toggleBulletList().run()} />
      <ToolbarButton label="Numbered list" Icon={ListOrdered} active={state.numbers} onClick={() => run().toggleOrderedList().run()} />
      <ToolbarButton label="Quote" Icon={Quote} active={state.quote} onClick={() => run().toggleBlockquote().run()} />
      <ToolbarButton
        label="Link"
        Icon={LinkIcon}
        active={state.link}
        onClick={() => {
          const href = linkAddress(window.prompt("Link address (https://…)") ?? "");
          if (href) run().extendMarkRange("link").setLink({ href }).run();
        }}
      />
      <ToolbarButton label="Remove link" Icon={Link2Off} disabled={!state.link} onClick={() => run().extendMarkRange("link").unsetLink().run()} />
    </div>
  );
}

/**
 * Rich text for a block, stored as HTML in the block's `html` prop. TipTap only produces what its schema allows; the
 * server cleans it to the page allowlist on every save too (src/lib/landing/sanitize.ts), so what is stored is never raw.
 */
export function RichTextField({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) {
  const editor = useEditor({
    injectNonce: documentNonce(), // TipTap's own style tag needs the page's nonce (src/lib/csp-nonce.ts)
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false }, heading: { levels: [2, 3] } })],
    content: value ?? "",
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": label, class: "prose prose-slate min-h-32 max-w-none rounded-b border border-slate-300 bg-white p-3 text-sm focus:outline-none dark:border-slate-600" } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });
  if (!editor) return <p className="text-sm text-slate-600">Loading the editor…</p>;
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/** A picture from the media library (or uploaded to it). The page uses it at the size its block asks for. */
export function ImageField({ value, onChange, noun = "image" }: { value: string | undefined; onChange: (id: string) => void; noun?: string }) {
  return <MediaPicker value={value || null} onChange={(id) => onChange(id ?? "")} surface="landing_page" preview="event_card" noun={noun} />;
}

/** A moment, typed as a wall-clock time in the organization's zone and stored as an instant (UTC). */
export function ZonedDateTimeField({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) {
  return (
    <div>
      <input
        type="datetime-local"
        aria-label={label}
        defaultValue={value ? utcToZonedLocal(value) : ""}
        onChange={(e) => onChange(e.target.value ? (zonedLocalToUtc(e.target.value) ?? "") : "")}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-slate-600">Time in {ORG_TIMEZONE.replace(/_/g, " ")}, whatever time zone the visitor is in.</p>
    </div>
  );
}
