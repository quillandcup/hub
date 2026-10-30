"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import { statusChoices, statusLabel, type Ancestor } from "@/lib/courses/status-choices";

/** What the outline needs of a course. Lesson ids are Kajabi's; Hub ids come from `hubLessonIds`. */
export interface OutlineCourse {
  /** Kajabi course id, for the lesson builder links. */
  kajabiId: string;
  /** The Hub slug, or null until the course is published. */
  slug: string | null;
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  /** Per Kajabi lesson id: what the content step found. */
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
  /** Kajabi lesson id -> Hub lesson id, for lessons that are in the Hub. */
  hubLessonIds: Record<string, string>;
}

const SOON = "Not available yet: courses are imported from Kajabi for now";

const PILL: Record<string, string> = {
  published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  locked: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  drip: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
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
};

function StatusPill({ title, option, ancestors }: { title: string; option: string | null; ancestors: Ancestor[] }) {
  return (
    <select
      aria-label={`Status of ${title}`}
      disabled
      defaultValue={option ?? ""}
      title={SOON}
      className={`shrink-0 cursor-not-allowed appearance-none rounded-full border-0 px-3 py-1 text-xs font-semibold disabled:opacity-100 ${PILL[option ?? "draft"] ?? PILL.draft}`}
    >
      {!statusChoices(ancestors, option).some((c) => c.value === option) && <option value={option ?? ""}>{statusLabel(option)}</option>}
      {statusChoices(ancestors, option).map((c) => (
        <option key={c.value} value={c.value} disabled={!!c.disabledReason} title={c.disabledReason}>
          {c.value === option ? c.label : c.action}
          {c.disabledReason ? ` (${c.disabledReason})` : ""}
        </option>
      ))}
    </select>
  );
}

/** A button for an action the builder will have; disabled until it can save. */
function Action({ label, icon, count }: { label: string; icon: keyof typeof ICONS; count?: number }) {
  return (
    <button type="button" disabled title={`${label}. ${SOON}`} aria-label={label} className="flex items-center gap-1 rounded p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300">
      <Icon path={ICONS[icon]} />
      {count !== undefined && <span className="text-xs">{count}</span>}
    </button>
  );
}

const HOVER_ACTIONS = "flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

function DragHandle({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={SOON} className="-ml-1 w-4 shrink-0 cursor-not-allowed text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
      <Icon path={ICONS.grip} />
    </span>
  );
}

function LessonRow({ lesson, course, ancestors, indent }: { lesson: ExplainedLesson; course: OutlineCourse; ancestors: Ancestor[]; indent: number }) {
  const content = course.content[lesson.kajabiId];
  const hubId = course.slug ? course.hubLessonIds[lesson.kajabiId] : undefined;
  const builder = `/admin/courses/${course.kajabiId}/lessons/${lesson.kajabiId}`;
  return (
    <li className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-3 dark:border-slate-800" style={{ paddingLeft: `${1 + indent * 1.5}rem` }}>
      <DragHandle label="Drag to reorder lesson" />
      <Icon path={ICONS.video} className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="min-w-0 flex-1">
        <Link href={builder} className="font-medium hover:underline">
          {lesson.title}
        </Link>
        <span className="block text-xs text-slate-600 dark:text-slate-400">
          {lesson.reason}
          {content && ` · text ${content.hasText ? "✓" : "–"} · video ${content.hasVideo ? "✓" : "–"}`}
        </span>
      </span>
      <span className={HOVER_ACTIONS}>
        <Link href={builder} aria-label="Edit video" title="Edit video" className="rounded p-1.5 text-slate-600 dark:text-slate-300">
          <Icon path={ICONS.edit} />
        </Link>
        <Action label="Duplicate video" icon="copy" />
        <Action label="Open video comments" icon="comment" />
        {hubId ? (
          <Link href={`/courses/${course.slug}/lessons/${hubId}`} aria-label="Open video preview" title="Open video preview" className="rounded p-1.5 text-slate-600 dark:text-slate-300">
            <Icon path={ICONS.eye} />
          </Link>
        ) : (
          <Action label="Open video preview" icon="eye" />
        )}
        <Action label="Delete video" icon="trash" />
      </span>
      <StatusPill title={lesson.title} option={lesson.publishingOption} ancestors={ancestors} />
    </li>
  );
}

/** Whether a module, or anything inside it, matches the search. */
function moduleMatches(module: ExplainedModule, q: string): boolean {
  return module.title.toLowerCase().includes(q) || module.lessons.some((l) => l.title.toLowerCase().includes(q)) || module.children.some((c) => moduleMatches(c, q));
}

function ModuleRow({
  module,
  course,
  ancestors,
  depth,
  query,
  expansion,
}: {
  module: ExplainedModule;
  course: OutlineCourse;
  ancestors: Ancestor[];
  depth: number;
  query: string;
  expansion: { open: boolean; version: number };
}) {
  // A section that appears after "Expand all" (a submodule inside one just opened) starts as that left everything.
  const [open, setOpen] = useState(expansion.open);
  const [seen, setSeen] = useState(expansion.version);
  // "Expand all" / "Collapse all" set every section at once; after that each one is its own again.
  if (seen !== expansion.version) {
    setSeen(expansion.version);
    setOpen(expansion.open);
  }
  const searching = query !== "";
  if (searching && !moduleMatches(module, query)) return null;
  const shown = searching || open;
  const below: Ancestor[] = [...ancestors, { title: module.title, publishingOption: module.publishingOption }];
  const submodule = depth > 0;
  const lessons = searching && !module.title.toLowerCase().includes(query) ? module.lessons.filter((l) => l.title.toLowerCase().includes(query)) : module.lessons;
  return (
    <li className={submodule ? "border-t border-slate-100 dark:border-slate-800" : "overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"}>
      <div className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
        <DragHandle label={`Drag to reorder ${submodule ? "submodule" : "module"}`} />
        <Icon path={ICONS.folder} className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{module.title}</span>
          <span className="block text-xs text-slate-600 dark:text-slate-400">{module.reason}</span>
        </span>
        <span className={HOVER_ACTIONS}>
          <Action label={submodule ? "Edit submodule" : "Edit module"} icon="edit" />
          <Action label={submodule ? "Duplicate submodule" : "Duplicate module"} icon="copy" />
          <Action label={submodule ? "Open submodule preview" : "Open module preview"} icon="eye" />
          <Action label={submodule ? "Delete submodule" : "Delete module"} icon="trash" />
        </span>
        <button type="button" disabled title={SOON} className="flex items-center gap-1 text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300">
          <Icon path={ICONS.plus} />
          Add content
        </button>
        <StatusPill title={module.title} option={module.publishingOption} ancestors={ancestors} />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={shown}
          aria-label={`${shown ? "Collapse" : "Expand"} ${module.title}`}
          className="rounded p-1 text-slate-600 dark:text-slate-300"
        >
          <Icon path={ICONS.chevron} className={`h-4 w-4 transition-transform ${shown ? "rotate-180" : ""}`} />
        </button>
      </div>
      {shown && (
        <ul>
          {lessons.map((l) => (
            <LessonRow key={l.kajabiId} lesson={l} course={course} ancestors={below} indent={depth + 1} />
          ))}
          {module.children.map((child) => (
            <ModuleRow key={child.kajabiId} module={child} course={course} ancestors={below} depth={depth + 1} query={query} expansion={expansion} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The course outline as Kajabi's builder shows it: collapsible modules with submodules and lessons,
 * a search, and per row a drag handle, hover actions and a quick status menu. Reading it works
 * (search, expand, open a lesson or its preview); everything that changes the course is disabled
 * until the builder can save (docs/COURSES.md, "Course builder").
 */
export default function BuilderOutline({ course }: { course: OutlineCourse }) {
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState({ open: false, version: 0 });
  const q = query.trim().toLowerCase();
  const loose = q ? course.loose.filter((l) => l.title.toLowerCase().includes(q)) : course.loose;
  const empty = course.modules.length === 0 && course.loose.length === 0;
  return (
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
          <button type="button" disabled title={SOON} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600">
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
      {empty && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">No modules yet.</p>}
      {loose.length > 0 && (
        <ul className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          {loose.map((l) => (
            <LessonRow key={l.kajabiId} lesson={l} course={course} ancestors={[]} indent={0} />
          ))}
        </ul>
      )}
      <ol className="mt-4 space-y-3">
        {course.modules.map((m) => (
          <ModuleRow key={m.kajabiId} module={m} course={course} ancestors={[]} depth={0} query={q} expansion={expansion} />
        ))}
      </ol>
    </div>
  );
}
