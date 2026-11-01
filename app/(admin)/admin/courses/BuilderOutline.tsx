"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import { moduleContents, moveBefore, moveBy } from "@/lib/courses/hub-outline";
import { statusChoices, statusLabel } from "@/lib/courses/status-choices";
import { addCourseLesson, addCourseModule, deleteCourseItem, duplicateCourseItem, renameCourseItem, reorderCourseItems, setCourseItemStatus, type ItemKind, type OutlineResult } from "./outline-actions";

/** What the outline needs of a course. For an imported course the ids are Kajabi's; for a Hub-owned one they are its own. */
export interface OutlineCourse {
  /** The course's Hub id (for the lesson builder links). */
  id: string;
  /** The Hub slug, or null until the course is published. */
  slug: string | null;
  /** A Hub-owned course: the outline can be changed. An imported one is shown read only. */
  editable?: boolean;
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  /** Per lesson id: what the content step found. */
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
  /** Kajabi lesson id -> Hub lesson id, for lessons that are in the Hub. */
  hubLessonIds: Record<string, string>;
}

const SOON_IMPORTED = "Not available yet: courses are imported from Kajabi for now";
const SOON_HUB = "Not available yet";

const PILL: Record<string, string> = {
  published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  locked: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  drip: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  inherit: "bg-white text-slate-600 ring-1 ring-inset ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-600",
};

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  folder: "M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8H16A1.5 1.5 0 0 1 17.5 7.8V14A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14z",
  video: "M3 6.5A1.5 1.5 0 0 1 4.5 5h7A1.5 1.5 0 0 1 13 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5zM13 9l4-2v6l-4-2",
  edit: "M4 13.5V16h2.5l7-7L11 6.5zM12 5.5l2.5 2.5",
  copy: "M7 7h8v8H7zM5 13V5h8",
  comment: "M4 5h12v8H9l-3 3v-3H4z",
  eye: "M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  trash: "M5 6h10M8 6V4h4v2M6.5 6l.5 10h6l.5-10",
  plus: "M10 4v12M4 10h12",
  chevron: "m5 8 5 5 5-5",
  grip: "M4 7.5h12M4 12.5h12",
  up: "m5 12 5-5 5 5",
  down: "m5 8 5 5 5-5",
};

/** What the rows share: which course, whether it can be changed, and how a change is made. */
interface Editor {
  courseId: string;
  busy: boolean;
  /** Runs a change; resolves true when it worked (the page is then refreshed), false with the reason shown above the outline. */
  run: (action: () => Promise<OutlineResult>) => Promise<boolean>;
  /** What is being dragged, if anything. */
  drag: { current: Dragged | null; start: (item: Dragged) => void; end: () => void };
}
interface Dragged {
  kind: ItemKind;
  parentId: string | null;
  id: string;
}
interface OutlineContextValue {
  course: OutlineCourse;
  editor: Editor | null;
  /** Why a control that isn't built yet is off. */
  soon: string;
}
const OutlineContext = createContext<OutlineContextValue | null>(null);
const useOutline = () => useContext(OutlineContext)!;

/** A row's own setting. In a Hub-owned course it can be changed here; in an imported one it is Kajabi's, shown as it is. */
function StatusPill({ title, option, kind, id }: { title: string; option: string | null; kind: ItemKind; id: string }) {
  const { soon, editor } = useOutline();
  const choices = statusChoices(option, !!editor);
  return (
    <select
      aria-label={`Status of ${title}`}
      disabled={!editor || editor.busy}
      value={option ?? ""}
      onChange={editor ? (e) => void editor.run(() => setCourseItemStatus(editor.courseId, kind, id, e.target.value)) : undefined}
      title={editor ? undefined : soon}
      className={`shrink-0 appearance-none rounded-full border-0 px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-100 ${PILL[option ?? "draft"] ?? PILL.draft}`}
    >
      {!choices.some((c) => c.value === option) && <option value={option ?? ""}>{statusLabel(option)}</option>}
      {choices.map((c) => (
        // The reason a choice is blocked is the tooltip, not option text: a select is as wide as its longest option.
        <option key={c.value} value={c.value} disabled={!!c.disabledReason} title={c.disabledReason}>
          {c.value === option ? c.label : c.action}
        </option>
      ))}
    </select>
  );
}

const ACTION = "flex items-center gap-1 rounded p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300";

/** An action: a working button when `onClick` is given, otherwise off with the reason on hover. */
function Action({ label, icon, count, onClick, disabled }: { label: string; icon: keyof typeof ICONS; count?: number; onClick?: () => void; disabled?: boolean }) {
  const { soon, editor } = useOutline();
  const working = !!onClick;
  return (
    <button type="button" disabled={!working || disabled || editor?.busy} onClick={onClick} title={working ? label : `${label}. ${soon}`} aria-label={label} className={ACTION}>
      <Icon path={ICONS[icon]} />
      {count !== undefined && <span className="text-xs">{count}</span>}
    </button>
  );
}

const HOVER_ACTIONS = "flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

/** What to reorder when something is dropped on a row: the row's own list and parent. */
interface Sibling {
  kind: ItemKind;
  parentId: string | null;
  id: string;
  /** Every id in the list, in order. */
  ids: string[];
}

function DragHandle({ label, sibling }: { label: string; sibling?: Sibling }) {
  const { editor, soon } = useOutline();
  if (!editor || !sibling) {
    return (
      <span role="img" aria-label={label} title={soon} className="-ml-1 w-4 shrink-0 cursor-not-allowed text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
        <Icon path={ICONS.grip} />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      draggable
      onDragStart={(e) => {
        editor.drag.start({ kind: sibling.kind, parentId: sibling.parentId, id: sibling.id });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", sibling.id); // Firefox won't start a drag without data
      }}
      onDragEnd={() => editor.drag.end()}
      className="-ml-1 w-4 shrink-0 cursor-grab text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <Icon path={ICONS.grip} />
    </span>
  );
}

/** Props that make a row a drop target for items of its own list: dropping puts the dragged item where the row is. */
function dropProps(editor: Editor | null, sibling?: Sibling) {
  if (!editor || !sibling) return {};
  const same = () => {
    const d = editor.drag.current;
    return !!d && d.kind === sibling.kind && d.parentId === sibling.parentId && d.id !== sibling.id;
  };
  return {
    onDragOver: (e: React.DragEvent) => {
      if (same()) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!same()) return;
      e.preventDefault();
      const dragged = editor.drag.current!;
      editor.drag.end();
      const order = moveBefore(sibling.ids, dragged.id, sibling.id);
      if (order !== sibling.ids) void editor.run(() => reorderCourseItems(editor.courseId, sibling.kind, sibling.parentId, order));
    },
  };
}

/** Move up and Move down, for people who can't drag. */
function MoveButtons({ sibling, what }: { sibling?: Sibling; what: string }) {
  const { editor } = useOutline();
  if (!editor || !sibling) return null;
  const move = (delta: -1 | 1) => void editor.run(() => reorderCourseItems(editor.courseId, sibling.kind, sibling.parentId, moveBy(sibling.ids, sibling.id, delta)));
  const index = sibling.ids.indexOf(sibling.id);
  return (
    <>
      <Action label={`Move ${what} up`} icon="up" onClick={() => move(-1)} disabled={index <= 0} />
      <Action label={`Move ${what} down`} icon="down" onClick={() => move(1)} disabled={index === sibling.ids.length - 1} />
    </>
  );
}

/** A one-line text field that saves on Enter and cancels on Escape. */
function NameField({ label, initial, placeholder, submitLabel, onSubmit, onCancel }: { label: string; initial: string; placeholder?: string; submitLabel: string; onSubmit: (title: string) => Promise<boolean>; onCancel: () => void }) {
  const { editor } = useOutline();
  const [value, setValue] = useState(initial);
  const submit = async () => {
    if (await onSubmit(value)) onCancel();
  };
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        type="text"
        aria-label={label}
        value={value}
        autoFocus
        placeholder={placeholder}
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") onCancel();
        }}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
      />
      <button type="button" onClick={() => void submit()} disabled={editor?.busy} className="rounded bg-plum-600 px-3 py-1 text-xs font-medium text-white hover:bg-plum-700 disabled:opacity-50">
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1 text-xs font-medium dark:border-slate-600">
        Cancel
      </button>
    </span>
  );
}

/** Asks before deleting, and says what goes with it. */
function DeleteDialog({ title, what, detail, onConfirm, onClose }: { title: string; what: string; detail: string | null; onConfirm: () => Promise<boolean>; onClose: () => void }) {
  const { editor } = useOutline();
  return (
    <Modal isOpen onClose={onClose} title={`Delete ${what}?`} maxWidth="md">
      <div className="p-6">
        <p className="text-sm">
          “{title}” will be deleted for good.{detail && ` ${detail}`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={editor?.busy}
            onClick={async () => {
              if (await onConfirm()) onClose();
              else onClose(); // the reason is shown above the outline
            }}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Delete {what}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LessonRow({ lesson, indent, sibling }: { lesson: ExplainedLesson; indent: number; sibling?: Sibling }) {
  const { course, editor } = useOutline();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const content = course.content[lesson.kajabiId];
  const hubId = course.slug ? course.hubLessonIds[lesson.kajabiId] : undefined;
  // A lesson has a builder page once it is in the Hub (published), under its own Hub id.
  const builder = hubId ? `/admin/courses/${course.id}/lessons/${hubId}` : null;
  const preview = hubId ? `/courses/${course.slug}/lessons/${hubId}` : null;
  return (
    <li
      className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-3 dark:border-slate-800"
      style={{ paddingLeft: `${1 + indent * 1.5}rem` }}
      {...dropProps(editor, sibling)}
    >
      <DragHandle label="Drag to reorder lesson" sibling={sibling} />
      <Icon path={ICONS.video} className="h-4 w-4 shrink-0 text-slate-500" />
      {renaming && editor ? (
        <NameField label="Lesson name" initial={lesson.title} submitLabel="Save" onSubmit={(title) => editor.run(() => renameCourseItem(editor.courseId, "lesson", lesson.kajabiId, title))} onCancel={() => setRenaming(false)} />
      ) : (
        <span className="min-w-0 flex-1">
          {!builder ? (
            <span className="font-medium">{lesson.title}</span>
          ) : (
            <Link href={builder} className="font-medium hover:underline">
              {lesson.title}
            </Link>
          )}
          <span className="block text-xs text-slate-600 dark:text-slate-400">
            {lesson.reason}
            {content && ` · text ${content.hasText ? "✓" : "–"} · video ${content.hasVideo ? "✓" : "–"}`}
          </span>
        </span>
      )}
      <span className={HOVER_ACTIONS}>
        {editor ? (
          <>
            <Action label="Rename lesson" icon="edit" onClick={() => setRenaming(true)} />
            <Action label="Duplicate lesson" icon="copy" onClick={() => void editor.run(() => duplicateCourseItem(editor.courseId, "lesson", lesson.kajabiId))} />
            <Action label="Open lesson comments" icon="comment" />
          </>
        ) : (
          <>
            {builder && (
              <Link href={builder} aria-label="Edit video" title="Edit video" className="rounded p-1.5 text-slate-600 dark:text-slate-300">
                <Icon path={ICONS.edit} />
              </Link>
            )}
            <Action label="Duplicate video" icon="copy" />
            <Action label="Open video comments" icon="comment" />
          </>
        )}
        {preview ? (
          <Link href={preview} aria-label={editor ? "Open lesson preview" : "Open video preview"} title={editor ? "Open lesson preview" : "Open video preview"} className="rounded p-1.5 text-slate-600 dark:text-slate-300">
            <Icon path={ICONS.eye} />
          </Link>
        ) : (
          <Action label={editor ? "Open lesson preview" : "Open video preview"} icon="eye" />
        )}
        {editor ? <Action label="Delete lesson" icon="trash" onClick={() => setConfirming(true)} /> : <Action label="Delete video" icon="trash" />}
        <MoveButtons sibling={sibling} what="lesson" />
      </span>
      <StatusPill title={lesson.title} option={lesson.publishingOption} kind="lesson" id={lesson.kajabiId} />
      {confirming && editor && (
        <DeleteDialog title={lesson.title} what="lesson" detail={null} onConfirm={() => editor.run(() => deleteCourseItem(editor.courseId, "lesson", lesson.kajabiId))} onClose={() => setConfirming(false)} />
      )}
    </li>
  );
}

/** Whether a module, or anything inside it, matches the search. */
function moduleMatches(parent: ExplainedModule, q: string): boolean {
  return parent.title.toLowerCase().includes(q) || parent.lessons.some((l) => l.title.toLowerCase().includes(q)) || parent.children.some((c) => moduleMatches(c, q));
}

function ModuleRow({
  module: mod,
  depth,
  query,
  expansion,
  sibling,
}: {
  module: ExplainedModule;
  depth: number;
  query: string;
  expansion: { open: boolean; version: number };
  sibling?: Sibling;
}) {
  const { course, editor } = useOutline();
  // A section that appears after "Expand all" (a submodule inside one just opened) starts as that left everything.
  const [open, setOpen] = useState(expansion.open);
  const [seen, setSeen] = useState(expansion.version);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState<"lesson" | "submodule" | null>(null);
  // "Expand all" / "Collapse all" set every section at once; after that each one is its own again.
  if (seen !== expansion.version) {
    setSeen(expansion.version);
    setOpen(expansion.open);
  }
  const searching = query !== "";
  if (searching && !moduleMatches(mod, query)) return null;
  const shown = searching || open || adding !== null;
  const submodule = depth > 0;
  const noun = submodule ? "submodule" : "module";
  const lessons = searching && !mod.title.toLowerCase().includes(query) ? mod.lessons.filter((l) => l.title.toLowerCase().includes(query)) : mod.lessons;
  const lessonIds = mod.lessons.map((l) => l.kajabiId);
  const childIds = mod.children.map((c) => c.kajabiId);
  const contents = moduleContents(mod);
  const goes = [contents.lessons > 0 && `${contents.lessons} lesson${contents.lessons === 1 ? "" : "s"}`, contents.submodules > 0 && `${contents.submodules} submodule${contents.submodules === 1 ? "" : "s"}`].filter(Boolean);
  // A Hub-owned module has a member page to preview it on; an imported one has none we link to.
  const preview = course.slug && editor ? `/courses/${course.slug}/modules/${mod.kajabiId}` : null;
  return (
    <li className={submodule ? "border-t border-slate-100 dark:border-slate-800" : "overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"} {...dropProps(editor, sibling)}>
      <div className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
        <DragHandle label={`Drag to reorder ${noun}`} sibling={sibling} />
        <Icon path={ICONS.folder} className="h-4 w-4 shrink-0 text-slate-500" />
        {renaming && editor ? (
          <NameField label={`${submodule ? "Submodule" : "Module"} name`} initial={mod.title} submitLabel="Save" onSubmit={(title) => editor.run(() => renameCourseItem(editor.courseId, "module", mod.kajabiId, title))} onCancel={() => setRenaming(false)} />
        ) : (
          <span className="min-w-0 flex-1">
            <span className="font-medium">{mod.title}</span>
            <span className="block text-xs text-slate-600 dark:text-slate-400">{mod.reason}</span>
          </span>
        )}
        <span className={HOVER_ACTIONS}>
          <Action label={`Edit ${noun}`} icon="edit" onClick={editor ? () => setRenaming(true) : undefined} />
          <Action label={`Duplicate ${noun}`} icon="copy" onClick={editor ? () => void editor.run(() => duplicateCourseItem(editor.courseId, "module", mod.kajabiId)) : undefined} />
          {preview ? (
            <Link href={preview} aria-label={`Open ${noun} preview`} title={`Open ${noun} preview`} className="rounded p-1.5 text-slate-600 dark:text-slate-300">
              <Icon path={ICONS.eye} />
            </Link>
          ) : (
            <Action label={`Open ${noun} preview`} icon="eye" />
          )}
          <Action label={`Delete ${noun}`} icon="trash" onClick={editor ? () => setConfirming(true) : undefined} />
          <MoveButtons sibling={sibling} what={noun} />
        </span>
        <span className="relative">
          <button
            type="button"
            disabled={!editor || editor.busy}
            title={editor ? undefined : SOON_IMPORTED}
            aria-haspopup={editor ? "menu" : undefined}
            aria-expanded={editor ? menu : undefined}
            onClick={editor ? () => setMenu(!menu) : undefined}
            className="flex items-center gap-1 text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300"
          >
            <Icon path={ICONS.plus} />
            Add content
          </button>
          {menu && editor && (
            <div role="menu" aria-label={`Add to ${mod.title}`} className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen(true); setAdding("lesson"); }} className="block w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                Add lesson
              </button>
              {!submodule && (
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen(true); setAdding("submodule"); }} className="block w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                  Add submodule
                </button>
              )}
            </div>
          )}
        </span>
        <StatusPill title={mod.title} option={mod.publishingOption} kind="module" id={mod.kajabiId} />
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={shown} aria-label={`${shown ? "Collapse" : "Expand"} ${mod.title}`} className="rounded p-1 text-slate-600 dark:text-slate-300">
          <Icon path={ICONS.chevron} className={`h-4 w-4 transition-transform ${shown ? "rotate-180" : ""}`} />
        </button>
      </div>
      {shown && (
        <ul>
          {lessons.map((l) => (
            <LessonRow key={l.kajabiId} lesson={l} indent={depth + 1} sibling={editor && !searching ? { kind: "lesson", parentId: mod.kajabiId, id: l.kajabiId, ids: lessonIds } : undefined} />
          ))}
          {mod.children.map((child) => (
            <ModuleRow
              key={child.kajabiId}
              module={child}
             
              depth={depth + 1}
              query={query}
              expansion={expansion}
              sibling={editor && !searching ? { kind: "module", parentId: mod.kajabiId, id: child.kajabiId, ids: childIds } : undefined}
            />
          ))}
          {adding && editor && (
            <li className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800" style={{ paddingLeft: `${1 + (depth + 1) * 1.5}rem` }}>
              <NameField
                label={adding === "lesson" ? "New lesson name" : "New submodule name"}
                initial=""
                placeholder={adding === "lesson" ? "Lesson name" : "Submodule name"}
                submitLabel="Add"
                onSubmit={(title) => editor.run(() => (adding === "lesson" ? addCourseLesson(editor.courseId, mod.kajabiId, title) : addCourseModule(editor.courseId, mod.kajabiId, title)))}
                onCancel={() => setAdding(null)}
              />
            </li>
          )}
        </ul>
      )}
      {confirming && editor && (
        <DeleteDialog
          title={mod.title}
          what={noun}
          detail={goes.length > 0 ? `Its ${goes.join(" and ")} will be deleted with it.` : null}
          onConfirm={() => editor.run(() => deleteCourseItem(editor.courseId, "module", mod.kajabiId))}
          onClose={() => setConfirming(false)}
        />
      )}
    </li>
  );
}

/**
 * The course outline as Kajabi's builder shows it: collapsible modules with submodules and lessons,
 * a search, and per row a drag handle, hover actions and a quick status menu. An imported course is
 * read only (search, expand, open a lesson or its preview; the rest is off until a course is taken
 * over from Kajabi). A Hub-owned course (`editable`) can be changed: add, rename, duplicate, delete
 * and reorder modules, submodules and lessons, by dragging or with Move up and down; the status
 * menu comes next.
 */
export default function BuilderOutline({ course }: { course: OutlineCourse }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState({ open: false, version: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingModule, setAddingModule] = useState(false);
  const [dragged, setDragged] = useState<Dragged | null>(null);

  const editor: Editor | null = course.editable
    ? {
        courseId: course.id,
        busy,
        drag: { current: dragged, start: setDragged, end: () => setDragged(null) },
        run: async (action) => {
          setError(null);
          setBusy(true);
          try {
            const result = await action();
            if (result.error) {
              setError(result.error);
              return false;
            }
            router.refresh();
            return true;
          } catch {
            setError("Something went wrong. Refresh the page and try again.");
            return false;
          } finally {
            setBusy(false);
          }
        },
      }
    : null;

  const q = query.trim().toLowerCase();
  const loose = q ? course.loose.filter((l) => l.title.toLowerCase().includes(q)) : course.loose;
  const empty = course.modules.length === 0 && course.loose.length === 0;
  const moduleIds = course.modules.map((m) => m.kajabiId);
  const looseIds = course.loose.map((l) => l.kajabiId);
  return (
    <OutlineContext.Provider value={{ course, editor, soon: course.editable ? SOON_HUB : SOON_IMPORTED }}>
      <div>
        <label className="block">
          <span className="sr-only">Find module or lesson</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find module or lesson…"
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {course.modules.length} {course.modules.length === 1 ? "Module" : "Modules"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!editor || busy}
              title={editor ? undefined : SOON_IMPORTED}
              onClick={editor ? () => setAddingModule(true) : undefined}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600"
            >
              Add module
            </button>
            <button
              type="button"
              onClick={() => setExpansion((e) => ({ open: !e.open, version: e.version + 1 }))}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-600"
            >
              {expansion.open ? "Collapse all" : "Expand all"}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-4 flex items-start justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 underline">
              Dismiss
            </button>
          </p>
        )}
        {empty && !addingModule && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">No modules yet.</p>}
        {loose.length > 0 && (
          <ul className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {loose.map((l) => (
              <LessonRow key={l.kajabiId} lesson={l} indent={0} sibling={editor && !q ? { kind: "lesson", parentId: null, id: l.kajabiId, ids: looseIds } : undefined} />
            ))}
          </ul>
        )}
        <ol className="mt-4 space-y-3">
          {course.modules.map((m) => (
            <ModuleRow key={m.kajabiId} module={m} depth={0} query={q} expansion={expansion} sibling={editor && !q ? { kind: "module", parentId: null, id: m.kajabiId, ids: moduleIds } : undefined} />
          ))}
          {addingModule && editor && (
            <li className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <NameField label="New module name" initial="" placeholder="Module name" submitLabel="Add" onSubmit={(title) => editor.run(() => addCourseModule(editor.courseId, null, title))} onCancel={() => setAddingModule(false)} />
            </li>
          )}
        </ol>
      </div>
    </OutlineContext.Provider>
  );
}
