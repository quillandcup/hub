"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon, { type IconName } from "@/components/Icon";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import { moduleContents } from "@/lib/courses/hub-outline";
import { lifecycleConfirm, lifecycleIcon, lifecycleLabel } from "@/lib/lifecycle-actions";
import { moveBefore, moveToPosition, positionItems, positionsHeading } from "@/lib/reorder";
import { statusChoices, statusLabel } from "@/lib/courses/status-choices";
import { addQuizLesson } from "./quiz-actions";
import { addCourseLesson, addCourseModule, deleteCourseItem, duplicateCourseItem, renameCourseItem, reorderCourseItems, setCourseItemStatus, type ItemKind, type OutlineResult } from "./outline-actions";
import Tooltip from "@/components/Tooltip";

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
  content: Record<string, { hasText: boolean; hasVideo: boolean; isQuiz?: boolean }>;
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
  const choices = statusChoices(option);
  // An <option> can't carry a tooltip: the reasons a choice is blocked are the select's own hint.
  const blockedReasons = choices.filter((c) => c.disabledReason).map((c) => `${c.action}: ${c.disabledReason}`).join(" ");
  return (
    <Tooltip content={editor ? blockedReasons || undefined : soon}>
      <select
        aria-label={`Status of ${title}`}
        disabled={!editor || editor.busy}
        value={option ?? ""}
        onChange={editor ? (e) => void editor.run(() => setCourseItemStatus(editor.courseId, kind, id, e.target.value)) : undefined}
        className={`order-last min-h-10 shrink-0 appearance-none rounded-full border-0 px-3 py-1 text-xs font-semibold @split:order-none @split:min-h-0 disabled:cursor-not-allowed disabled:opacity-100 ${PILL[option ?? "draft"] ?? PILL.draft}`}
      >
        {!choices.some((c) => c.value === option) && <option value={option ?? ""}>{statusLabel(option)}</option>}
        {choices.map((c) => (
          // The reason a choice is blocked is the select's tooltip, not option text: a select is as wide as its longest option.
          <option key={c.value} value={c.value} disabled={!!c.disabledReason}>
            {c.value === option ? c.label : c.action}
          </option>
        ))}
      </select>
    </Tooltip>
  );
}

/**
 * A row is one line: the title gets the room (up to two lines, then cut with the full text on hover),
 * the status pill drops under it when there is no room beside it. `@container` is on the outline.
 */
const ROW_CLASS = "group flex flex-wrap items-center gap-x-2 gap-y-1 py-2 pr-2 @split:flex-nowrap @split:gap-x-3 @split:py-3";
const TITLE = "line-clamp-2 break-words";

/** A row's own state is already in its status pill; the reason is worth a line only when it explains something else (an item hidden by the module above it). */
function rowNote(reason: string): string | null {
  return reason === "Published" || / in (Kajabi|the Hub)$/.test(reason) ? null : reason;
}

const ACTION ="flex items-center gap-1 rounded p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300";

/** An action: a working button when `onClick` is given, otherwise off with the reason on hover. */
function Action({ label, icon, count, onClick, disabled }: { label: string; icon: IconName; count?: number; onClick?: () => void; disabled?: boolean }) {
  const { soon, editor } = useOutline();
  const working = !!onClick;
  return (
    <Tooltip content={working ? label : `${label}. ${soon}`}>
      <button type="button" disabled={!working || disabled || editor?.busy} onClick={onClick} aria-label={label} className={ACTION}>
        <Icon name={icon} />
        {count !== undefined && <span className="text-xs">{count}</span>}
      </button>
    </Tooltip>
  );
}

/** The quick icons: only where the outline is wide (a narrow one gets the ⋯ menu), and always visible on a touch screen, which has no hover. */
const HOVER_ACTIONS = "hidden items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 @split:flex";

/**
 * One action of a row. The wide layout shows the ones with an `icon` as quick icons and the narrow one
 * lists them all in the row's ⋯ menu, so both come from this one list. Without `onClick` or `href` it
 * is off, with the reason as a tooltip (icon) or hint (menu).
 */
interface RowAction {
  key: string;
  label: string;
  icon?: IconName;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Off and not built yet: a quick icon says so, the menu leaves it out. */
  quickOnly?: boolean;
}

function RowActions({ name, actions, sibling }: { name: string; actions: RowAction[]; sibling?: Sibling }) {
  const { editor, soon } = useOutline();
  const items: ActionMenuItem[] = actions.filter((a) => !a.quickOnly).map((a) => {
    const working = !!a.onClick || !!a.href;
    return { key: a.key, label: a.label, href: a.href, onSelect: a.onClick, disabled: !working || a.disabled || editor?.busy, hint: working ? undefined : soon, track: "admin-course-row-action" };
  });
  // "Move to position", for people who can't drag: the same menu the writing lists have, among the row's siblings.
  // A row alone in its list has nothing to move to, so it gets no menu (as in the writing lists).
  const positions = movePositions(editor, sibling);
  const narrowItems = positions.length > 0 ? [...items, ...positions.map((p, i) => (i === 0 ? { ...p, separatorBefore: true } : p))] : items;
  return (
    <>
      <span className={HOVER_ACTIONS}>
        {actions
          .filter((a) => a.icon)
          .map((a) =>
            a.href ? (
              <Link key={a.key} href={a.href} aria-label={a.label} title={a.label} className="rounded p-1.5 text-slate-600 dark:text-slate-300">
                <Icon name={a.icon!} />
              </Link>
            ) : (
              <Action key={a.key} label={a.label} icon={a.icon!} onClick={a.onClick} disabled={a.disabled} />
            )
          )}
      </span>
      <span className="@split:hidden">
        <ActionMenu label={`Actions for ${name}`} items={narrowItems} />
      </span>
      {positions.length > 0 && (
        <span className="hidden @split:block">
          <ActionMenu
            label={`Move ${name} to position`}
            tooltip={`Move ${name} to position`}
            heading={positionsHeading(positions.length)}
            items={positions}
            trigger={<Icon name="reorder" />}
            triggerClassName="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          />
        </span>
      )}
    </>
  );
}

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
      <Tooltip content={soon}>
        <span role="img" aria-label={label} className="-ml-1 hidden w-4 shrink-0 cursor-not-allowed text-slate-400 @split:block opacity-0 transition-opacity group-hover:opacity-100">
          <Icon name="grip" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        draggable
        onDragStart={(e) => {
          editor.drag.start({ kind: sibling.kind, parentId: sibling.parentId, id: sibling.id });
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", sibling.id); // Firefox won't start a drag without data
        }}
        onDragEnd={() => editor.drag.end()}
        className="-ml-1 hidden w-4 shrink-0 cursor-grab text-slate-400 @split:block opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Icon name="grip" />
      </span>
    </Tooltip>
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

/**
 * The "Move to position" items for a row among its siblings (the same menu as the writing lists), for people who
 * can't drag. Empty for an imported course, while searching, and for a row alone in its list. Choosing one sends the
 * whole new order of the list, as a drop does.
 */
function movePositions(editor: Editor | null, sibling: Sibling | undefined): ActionMenuItem[] {
  if (!editor || !sibling || sibling.ids.length < 2) return [];
  const index = sibling.ids.indexOf(sibling.id);
  const move = (position: number) => void editor.run(() => reorderCourseItems(editor.courseId, sibling.kind, sibling.parentId, moveToPosition(sibling.ids, sibling.id, position)));
  return positionItems(sibling.ids.length, index, move, "admin-course-move-to-position").map((item) => ({ ...item, disabled: item.disabled || editor.busy }));
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
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      // The reason a delete failed is shown above the outline, so the dialog closes either way.
      onConfirm={async () => void (await onConfirm())}
      {...lifecycleConfirm("delete", { noun: what, title, detail: detail ?? undefined, permanent: true })!}
    />
  );
}

function LessonRow({ lesson, indent, sibling }: { lesson: ExplainedLesson; indent: number; sibling?: Sibling }) {
  const { course, editor } = useOutline();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const content = course.content[lesson.kajabiId];
  // A Hub-owned course's lessons are in the Hub from the start; an imported one's once the course is published.
  const hubId = course.slug || course.editable ? course.hubLessonIds[lesson.kajabiId] : undefined;
  // A lesson has a builder page once it is in the Hub, under its own Hub id.
  const builder = hubId ? `/admin/courses/${course.id}/lessons/${hubId}` : null;
  const preview = hubId && course.slug ? `/courses/${course.slug}/lessons/${hubId}` : null;
  const isQuiz = content?.isQuiz === true;
  const note = [rowNote(lesson.reason), isQuiz ? "Quiz" : content && `text ${content.hasText ? "✓" : "–"} · video ${content.hasVideo ? "✓" : "–"}`].filter(Boolean).join(" · ");
  const what = editor ? "lesson" : "video";
  const previewLabel = `Open ${what} preview`;
  const actions: RowAction[] = [
    { key: "edit", label: editor ? (isQuiz ? "Edit quiz" : "Edit lesson") : "Edit video", icon: "edit", href: builder ?? undefined },
    ...(editor ? [{ key: "rename", label: "Rename lesson", icon: "rename" as const, onClick: () => setRenaming(true) }] : []),
    { key: "duplicate", label: lifecycleLabel("duplicate", what), icon: lifecycleIcon("duplicate"), onClick: editor ? () => void editor.run(() => duplicateCourseItem(editor.courseId, "lesson", lesson.kajabiId)) : undefined },
    { key: "comments", label: `Open ${what} comments`, icon: "comment", quickOnly: true },
    { key: "preview", label: previewLabel, icon: lifecycleIcon("preview"), href: preview ?? undefined },
    { key: "delete", label: lifecycleLabel("delete", what), icon: lifecycleIcon("delete"), onClick: editor ? () => setConfirming(true) : undefined },
  ];
  return (
    <li
      className={ROW_CLASS + " border-t border-slate-100 dark:border-slate-800"}
      style={{ paddingLeft: `${0.75 + indent * 1}rem` }}
      {...dropProps(editor, sibling)}
    >
      <DragHandle label="Drag to reorder lesson" sibling={sibling} />
      <Icon name={isQuiz ? "quiz" : "video"} className="h-4 w-4 shrink-0 text-slate-500" />
      {renaming && editor ? (
        <NameField label="Lesson name" initial={lesson.title} submitLabel="Save" onSubmit={(title) => editor.run(() => renameCourseItem(editor.courseId, "lesson", lesson.kajabiId, title))} onCancel={() => setRenaming(false)} />
      ) : (
        <span className="min-w-0 flex-1 basis-32">
          {!builder ? (
            <Tooltip content={lesson.title}>
              <span className={`${TITLE} font-medium`}>{lesson.title}</span>
            </Tooltip>
          ) : (
            // Double-clicking the title renames it in place (the same as Rename lesson); a single click opens the lesson.
            <Link href={builder} title={lesson.title} onDoubleClick={editor ? (e) => { e.preventDefault(); setRenaming(true); } : undefined} className={`${TITLE} font-medium hover:underline`}>
              {lesson.title}
            </Link>
          )}
          {note && <span className="block text-xs text-slate-600 dark:text-slate-400">{note}</span>}
        </span>
      )}
      <RowActions name={lesson.title} actions={actions} sibling={sibling} />
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
  const [adding, setAdding] = useState<"lesson" | "quiz" | "submodule" | null>(null);
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
  const note = rowNote(mod.reason);
  const startAdding = (what: "lesson" | "quiz" | "submodule") => {
    setMenu(false);
    setOpen(true);
    setAdding(what);
  };
  const actions: RowAction[] = [
    { key: "edit", label: `Edit ${noun}`, icon: "edit", onClick: editor ? () => setRenaming(true) : undefined },
    { key: "duplicate", label: lifecycleLabel("duplicate", noun), icon: lifecycleIcon("duplicate"), onClick: editor ? () => void editor.run(() => duplicateCourseItem(editor.courseId, "module", mod.kajabiId)) : undefined },
    { key: "preview", label: `Open ${noun} preview`, icon: lifecycleIcon("preview"), href: preview ?? undefined },
    // On a wide outline these are the Add content button; here they are menu items.
    { key: "add-lesson", label: "Add lesson", onClick: editor ? () => startAdding("lesson") : undefined },
    { key: "add-quiz", label: "Add quiz", onClick: editor ? () => startAdding("quiz") : undefined },
    ...(submodule ? [] : [{ key: "add-submodule", label: "Add submodule", onClick: editor ? () => startAdding("submodule") : undefined }]),
    { key: "delete", label: lifecycleLabel("delete", noun), icon: lifecycleIcon("delete"), onClick: editor ? () => setConfirming(true) : undefined },
  ];
  return (
    <li className={submodule ?"border-t border-slate-100 dark:border-slate-800" : "overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"} {...dropProps(editor, sibling)}>
      <div className={ROW_CLASS} style={{ paddingLeft: `${0.75 + depth * 1}rem` }}>
        <DragHandle label={`Drag to reorder ${noun}`} sibling={sibling} />
        <Icon name="folder" className="h-4 w-4 shrink-0 text-slate-500" />
        {renaming && editor ? (
          <NameField label={`${submodule ? "Submodule" : "Module"} name`} initial={mod.title} submitLabel="Save" onSubmit={(title) => editor.run(() => renameCourseItem(editor.courseId, "module", mod.kajabiId, title))} onCancel={() => setRenaming(false)} />
        ) : (
          <span className="min-w-0 flex-1 basis-32">
            <Tooltip content={mod.title}>
              <span className={`${TITLE} font-medium`}>{mod.title}</span>
            </Tooltip>
            {note && <span className="block text-xs text-slate-600 dark:text-slate-400">{note}</span>}
          </span>
        )}
        <RowActions name={mod.title} actions={actions} sibling={sibling} />
        <span className="relative hidden @split:block">
          <Tooltip content={editor ? undefined : SOON_IMPORTED}>
            <button
              type="button"
              disabled={!editor || editor.busy}
              aria-haspopup={editor ? "menu" : undefined}
              aria-expanded={editor ? menu : undefined}
              onClick={editor ? () => setMenu(!menu) : undefined}
              className="flex items-center gap-1 text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300"
            >
              <Icon name="plus" />
              Add content
            </button>
          </Tooltip>
          {menu && editor && (
            <div role="menu" aria-label={`Add to ${mod.title}`} className="absolute right-0 z-dropdown mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen(true); setAdding("lesson"); }} className="block w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                Add lesson
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen(true); setAdding("quiz"); }} className="block w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                Add quiz
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
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={shown} aria-label={`${shown ? "Collapse" : "Expand"} ${mod.title}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-slate-600 @split:h-auto @split:w-auto @split:p-1 dark:text-slate-300">
          <Icon name="chevron" className={`h-4 w-4 transition-transform ${shown ? "rotate-180" : ""}`} />
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
                label={adding === "lesson" ? "New lesson name" : adding === "quiz" ? "New quiz name" : "New submodule name"}
                initial=""
                placeholder={adding === "lesson" ? "Lesson name" : adding === "quiz" ? "Quiz name" : "Submodule name"}
                submitLabel="Add"
                onSubmit={(title) =>
                  editor.run(() =>
                    adding === "lesson" ? addCourseLesson(editor.courseId, mod.kajabiId, title) : adding === "quiz" ? addQuizLesson(editor.courseId, mod.kajabiId, title) : addCourseModule(editor.courseId, mod.kajabiId, title),
                  )
                }
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
 * and reorder modules, submodules and lessons, by dragging or with the "Move to position" menu; the status
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
      <div className="@container">
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
            <Tooltip content={editor ? undefined : SOON_IMPORTED}>
              <button
                type="button"
                disabled={!editor || busy}
                onClick={editor ? () => setAddingModule(true) : undefined}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600"
              >
                Add module
              </button>
            </Tooltip>
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
