import Link from "next/link";
import { formatDuration, type Outline, type OutlineLesson, type OutlineNode } from "@/lib/courses/outline";

interface Props {
  slug: string;
  outline: Outline;
  completed: Set<string>;
  /** Lessons are links only when the member can open them (access not ended). */
  canOpen: boolean;
  /** Staff: "Coming soon" lessons open too, as a preview. */
  previewComingSoon?: boolean;
  currentLessonId?: string;
}

function LessonRow({ slug, lesson, completed, canOpen, current, previewComingSoon }: { slug: string; lesson: OutlineLesson; completed: boolean; canOpen: boolean; current: boolean; previewComingSoon?: boolean }) {
  const duration = formatDuration(lesson.duration_seconds);
  const comingSoon = lesson.state === "coming_soon";
  const content = (
    <>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          completed
            ? "border-plum-600 bg-plum-600 text-white"
            : "border-slate-300 dark:border-slate-600"
        }`}
      >
        {completed ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className={current ? "font-medium" : ""}>{lesson.title}</span>
        {completed && <span className="sr-only"> (completed)</span>}
      </span>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">Coming soon</span>
      ) : (
        duration && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{duration}</span>
      )}
    </>
  );
  const base = "flex items-start gap-2 rounded px-2 py-1.5 text-sm";
  if ((comingSoon && !previewComingSoon) || !canOpen) {
    return <li className={`${base} text-slate-500 dark:text-slate-400`}>{content}</li>;
  }
  return (
    <li>
      <Link
        href={`/courses/${slug}/lessons/${lesson.id}`}
        aria-current={current ? "page" : undefined}
        className={`${base} hover:bg-slate-100 dark:hover:bg-slate-800 ${current ? "bg-plum-50 text-plum-900 dark:bg-slate-800 dark:text-slate-100" : ""}`}
      >
        {content}
      </Link>
    </li>
  );
}

function ModuleNode({ node, depth, ...rest }: { node: OutlineNode; depth: number } & Omit<Props, "outline">) {
  const comingSoon = node.module.state === "coming_soon";
  const Heading = depth === 0 ? "h2" : "h3";
  return (
    <section className={depth > 0 ? "mt-3 ml-3 border-l border-slate-200 pl-3 dark:border-slate-700" : "mt-6"}>
      <Heading className={`flex items-center gap-2 ${depth === 0 ? "text-base font-semibold" : "text-sm font-medium"}`}>
        {node.module.title}
        {comingSoon && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">Coming soon</span>
        )}
      </Heading>
      <ul className="mt-1">
        {node.lessons.map((lesson) => (
          <LessonRow
            key={lesson.id}
            slug={rest.slug}
            lesson={lesson}
            completed={rest.completed.has(lesson.id)}
            canOpen={rest.canOpen}
            current={lesson.id === rest.currentLessonId}
            previewComingSoon={rest.previewComingSoon}
          />
        ))}
      </ul>
      {node.children.map((child) => (
        <ModuleNode key={child.module.id} node={child} depth={depth + 1} {...rest} />
      ))}
    </section>
  );
}

/** A course's modules, weeks and lessons: checkmarks, durations, and "Coming soon" for unreleased ones. */
export default function CourseOutline({ slug, outline, completed, canOpen, currentLessonId, previewComingSoon }: Props) {
  return (
    <nav aria-label="Course outline">
      {outline.loose.length > 0 && (
        <ul>
          {outline.loose.map((lesson) => (
            <LessonRow key={lesson.id} slug={slug} lesson={lesson} completed={completed.has(lesson.id)} canOpen={canOpen} current={lesson.id === currentLessonId} previewComingSoon={previewComingSoon} />
          ))}
        </ul>
      )}
      {outline.modules.map((node) => (
        <ModuleNode key={node.module.id} node={node} depth={0} slug={slug} completed={completed} canOpen={canOpen} currentLessonId={currentLessonId} previewComingSoon={previewComingSoon} />
      ))}
    </nav>
  );
}
