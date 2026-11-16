"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Bold, Italic, Link as LinkIcon, Link2Off, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, type LucideIcon } from "lucide-react";
import { linkAddress } from "@/components/chat/FormatToolbar";
import { saveLessonText } from "../../../outline-actions";
import { useLessonSave } from "./LessonSave";

const BUTTON =
  "flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-plum-50 aria-pressed:text-plum-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:aria-pressed:bg-plum-900/30 dark:aria-pressed:text-plum-300";

function ToolbarButton({ label, Icon, active, disabled, onClick }: { label: string; Icon: LucideIcon; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    // mousedown, not click: the editor would lose its selection before a click lands.
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={BUTTON}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />;

function Toolbar({ editor }: { editor: Editor }) {
  // The toolbar re-renders when the selection or the marks change, not on every keystroke.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();
  const setStyle = (style: string) => {
    if (style === "p") run().setParagraph().run();
    else run().setHeading({ level: style === "h2" ? 2 : 3 }).run();
  };
  return (
    <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 rounded-t border border-b-0 border-slate-300 bg-slate-50 px-2 py-1 dark:border-slate-600 dark:bg-slate-800/60">
      <select
        aria-label="Text style"
        value={state.style}
        onChange={(e) => setStyle(e.target.value)}
        className="mr-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <ToolbarButton label="Bold" Icon={Bold} active={state.bold} onClick={() => run().toggleBold().run()} />
      <ToolbarButton label="Italic" Icon={Italic} active={state.italic} onClick={() => run().toggleItalic().run()} />
      <ToolbarButton label="Underline" Icon={Underline} active={state.underline} onClick={() => run().toggleUnderline().run()} />
      <ToolbarButton label="Strikethrough" Icon={Strikethrough} active={state.strike} onClick={() => run().toggleStrike().run()} />
      <Divider />
      <ToolbarButton label="Bulleted list" Icon={List} active={state.bullets} onClick={() => run().toggleBulletList().run()} />
      <ToolbarButton label="Numbered list" Icon={ListOrdered} active={state.numbers} onClick={() => run().toggleOrderedList().run()} />
      <ToolbarButton label="Quote" Icon={Quote} active={state.quote} onClick={() => run().toggleBlockquote().run()} />
      <Divider />
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
      <Divider />
      <ToolbarButton label="Undo" Icon={Undo2} disabled={!state.canUndo} onClick={() => run().undo().run()} />
      <ToolbarButton label="Redo" Icon={Redo2} disabled={!state.canRedo} onClick={() => run().redo().run()} />
    </div>
  );
}

/**
 * The text of a Hub-owned lesson. It is saved with the page's Save button (not on every keystroke, so each save is
 * one entry in the audit log; see LessonSave); the server cleans it to the lesson allowlist before it is stored, so
 * what comes back after the save is what members see.
 */
export default function LessonTextEditor({ courseId, lessonId, initialHtml }: { courseId: string; lessonId: string; initialHtml: string | null }) {
  const router = useRouter();
  const { setDirty, setHandler, setMessage } = useLessonSave();

  const editor = useEditor({
    // StarterKit has headings, lists, quotes and links; images stay so a lesson that has one isn't stripped of it on save.
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false } }), Image],
    content: initialHtml ?? "",
    // Rendered on the client only: the editor builds its document from the browser's DOM.
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Lesson text", class: "prose prose-slate min-h-40 max-w-none rounded-b border border-slate-300 p-4 focus:outline-none dark:prose-invert dark:border-slate-600" } },
    onUpdate: () => {
      setDirty(true);
      setMessage({});
    },
  });

  // What the page's Save runs: the text as HTML for this lesson; resolves with the reason it was refused, if it was.
  useEffect(() => {
    setHandler(async () => {
      if (!editor) return null;
      const result = await saveLessonText(courseId, lessonId, editor.isEmpty ? "" : editor.getHTML());
      if (result.error) return result.error;
      router.refresh();
      return null;
    });
    return () => setHandler(null);
  }, [setHandler, editor, courseId, lessonId, router]);

  if (!editor) return <p className="text-sm text-slate-600 dark:text-slate-400">Loading the editor…</p>;
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
