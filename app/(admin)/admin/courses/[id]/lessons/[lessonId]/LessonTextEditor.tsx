"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { saveLessonText } from "../../../outline-actions";

const BUTTON =
  "rounded border border-slate-300 px-2.5 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-slate-200 dark:border-slate-600 dark:aria-pressed:bg-slate-700";

function ToolbarButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={BUTTON}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // The toolbar re-renders when the selection or the marks change, not on every keystroke.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Text formatting" className="mb-2 flex flex-wrap gap-1">
      <ToolbarButton label="Heading" active={state.h2} onClick={() => run().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton label="Subheading" active={state.h3} onClick={() => run().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
      <ToolbarButton label="Bold" active={state.bold} onClick={() => run().toggleBold().run()}><strong>B</strong></ToolbarButton>
      <ToolbarButton label="Italic" active={state.italic} onClick={() => run().toggleItalic().run()}><em>I</em></ToolbarButton>
      <ToolbarButton label="Underline" active={state.underline} onClick={() => run().toggleUnderline().run()}><u>U</u></ToolbarButton>
      <ToolbarButton label="Bulleted list" active={state.bullets} onClick={() => run().toggleBulletList().run()}>• List</ToolbarButton>
      <ToolbarButton label="Numbered list" active={state.numbers} onClick={() => run().toggleOrderedList().run()}>1. List</ToolbarButton>
      <ToolbarButton label="Quote" active={state.quote} onClick={() => run().toggleBlockquote().run()}>“ ”</ToolbarButton>
      <ToolbarButton
        label="Link"
        active={state.link}
        onClick={() => {
          const url = window.prompt("Link address (https://…)");
          if (url) run().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        Link
      </ToolbarButton>
      <ToolbarButton label="Remove link" disabled={!state.link} onClick={() => run().extendMarkRange("link").unsetLink().run()}>Unlink</ToolbarButton>
    </div>
  );
}

/**
 * The text of a Hub-owned lesson. Saved with the Save button (not on every keystroke, so each save is one
 * entry in the audit log); the server cleans it to the lesson allowlist before it is stored, so what comes
 * back after the save is what members see.
 */
export default function LessonTextEditor({ courseId, lessonId, initialHtml }: { courseId: string; lessonId: string; initialHtml: string | null }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error?: string; saved?: boolean }>({});

  const editor = useEditor({
    // StarterKit has headings, lists, quotes and links; images stay so a lesson that has one isn't stripped of it on save.
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false } }), Image],
    content: initialHtml ?? "",
    // Rendered on the client only: the editor builds its document from the browser's DOM.
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Lesson text", class: "prose prose-slate max-w-none rounded border border-slate-300 p-4 focus:outline-none dark:prose-invert dark:border-slate-600" } },
    onUpdate: () => {
      setDirty(true);
      setMessage({});
    },
  });

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setMessage({});
    try {
      const html = editor.isEmpty ? "" : editor.getHTML();
      const result = await saveLessonText(courseId, lessonId, html);
      if (result.error) setMessage({ error: result.error });
      else {
        setDirty(false);
        setMessage({ saved: true });
        router.refresh();
      }
    } catch {
      setMessage({ error: "Something went wrong. Refresh the page and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (!editor) return <p className="text-sm text-slate-600 dark:text-slate-400">Loading the editor…</p>;
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || saving} className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Saving…" : "Save text"}
        </button>
        {message.saved && <span role="status" className="text-sm text-slate-600 dark:text-slate-400">Saved.</span>}
        {message.error && <span role="alert" className="text-sm text-red-700 dark:text-red-300">{message.error}</span>}
      </div>
    </div>
  );
}
