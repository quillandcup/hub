import Link from "next/link";
import { courseImageUrl } from "@/lib/courses/images";
import type { Outline, OutlineLesson } from "@/lib/courses/outline";

interface Props {
  slug: string;
  /** A one-module outline (see lessonSection): the module the lesson is in, with its own lessons. */
  section: Outline;
  completed: Set<string>;
  currentLessonId: string;
  /** Staff: coming-soon lessons open too, as a preview. */
  previewComingSoon?: boolean;
  /** The first lesson of the next module, when there is one: the "Next Module" button goes there. */
  nextModule?: { id: string } | null;
}

function Row({ slug, lesson, number, completed, current, openable }: { slug: string; lesson: OutlineLesson; number: number; completed: boolean; current: boolean; openable: boolean }) {
  const thumbnail = courseImageUrl(lesson.thumbnail_url);
  const content = (
    <>
      <span aria-hidden="true" className="text-center text-sm text-slate-500 dark:text-slate-400">
        {current ? <span className="text-plum-400">▶</span> : number}
      </span>
      {thumbnail ? (
        // Decorative (the title is beside it); a plain img so any Kajabi image host works.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" loading="lazy" className="aspect-video w-full rounded object-cover" />
      ) : (
        <span aria-hidden="true" className="aspect-video w-full rounded bg-white/10" />
      )}
      <span className="min-w-0 text-sm leading-snug">
        {lesson.title}
        {completed && (
          <>
            {" "}
            <span className="sr-only">(completed)</span>
          </>
        )}
      </span>
      {/* A bold check in the Hub's color to the right of a completed lesson (the number stays on the left, as in Kajabi's). */}
      <span aria-hidden="true" className="flex w-5 justify-end text-plum-400">
        {completed && (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" data-testid="completed-check">
            <path d="M4 12.5l5.5 5.5L20 6.5" />
          </svg>
        )}
      </span>
    </>
  );
  const layout = "grid grid-cols-[1.25rem_6rem_minmax(0,1fr)_1.25rem] items-center gap-3 px-5 py-3";
  if (!openable) return <li className={`${layout} opacity-50`}>{content}</li>;
  return (
    <li>
      <Link
        href={`/courses/${slug}/lessons/${lesson.id}`}
        data-track="lesson-section-list-item"
        aria-current={current ? "page" : undefined}
        className={`${layout} transition hover:bg-white/5 ${current ? "bg-white/10" : ""}`}
      >
        {content}
      </Link>
    </li>
  );
}

/**
 * The lessons of the section (week or module) the current lesson is in, as the panel beside the
 * video: always dark, like the player, so the two read as one component. The caller sizes and
 * scrolls it. Lessons that aren't released show dimmed, without a label: the number and the dimming
 * are enough here.
 */
export default function LessonSectionList({ slug, section, completed, currentLessonId, previewComingSoon, nextModule }: Props) {
  const node = section.modules[0];
  const lessons = section.lessons;
  return (
    // The list block is a shade lighter than the panel around it, so where the list ends and the empty
    // panel carries on below it reads as a slightly different tone (as in Kajabi's).
    <nav aria-label="Lessons in this section" className="bg-neutral-800/60 pb-5 text-slate-100">
      <div className="flex items-baseline justify-between gap-3 px-5 py-4">
        <h2 className="font-semibold leading-snug">{node.module.title}</h2>
        <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
          {lessons.length} {lessons.length === 1 ? "Lesson" : "Lessons"}
        </span>
      </div>
      <ol>
        {lessons.map((lesson, i) => (
          <Row
            key={lesson.id}
            slug={slug}
            lesson={lesson}
            number={i + 1}
            completed={completed.has(lesson.id)}
            current={lesson.id === currentLessonId}
            openable={lesson.state === "open" || !!previewComingSoon}
          />
        ))}
      </ol>
      {nextModule && (
        <div className="mt-4 flex justify-center">
          <Link
            href={`/courses/${slug}/lessons/${nextModule.id}`}
            data-track="lesson-next-module"
            className="rounded bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Next Module
          </Link>
        </div>
      )}
    </nav>
  );
}
