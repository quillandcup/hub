import Link from "next/link";
import Icon from "@/components/Icon";
import { courseImageUrl } from "@/lib/courses/image-urls";
import type { LessonCommentCounts } from "@/lib/data/course-comments";
import { formatDuration, unreleasedLabel, type Outline, type OutlineLesson, type OutlineNode } from "@/lib/courses/outline";

interface Props {
  slug: string;
  outline: Outline;
  completed: Set<string>;
  /** Lessons are links only when the member can open them (access not ended). */
  canOpen: boolean;
  /** Staff: "Coming soon" lessons and drafts open too, as a preview. */
  previewComingSoon?: boolean;
  currentLessonId?: string;
  /** Comments per lesson (flag `lesson_comments`); lessons with none are absent. Omitted when comments are off for the viewer. */
  commentCounts?: ReadonlyMap<string, LessonCommentCounts>;
  /** Staff: also say how many questions are waiting for an answer. */
  showUnanswered?: boolean;
}

/** "3 comments", "3 comments, 1 new" and, for staff, ", 2 unanswered": a badge in the row, said in full to a screen reader. */
function CommentBadge({ counts, showUnanswered }: { counts: LessonCommentCounts; showUnanswered?: boolean }) {
  const parts = [`${counts.total} ${counts.total === 1 ? "comment" : "comments"}`];
  if (counts.newCount > 0) parts.push(`${counts.newCount} new`);
  if (showUnanswered && counts.unanswered > 0) parts.push(`${counts.unanswered} unanswered`);
  const highlight = counts.newCount > 0 || (showUnanswered && counts.unanswered > 0);
  return (
    <span
      data-testid="comment-badge"
      className={`mt-1 ml-2 inline-block rounded-full px-2 py-0.5 text-xs ${highlight ? "bg-plum-100 text-plum-800 dark:bg-plum-900 dark:text-plum-100" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}
    >
      <span className="sr-only">{parts.join(", ")}</span>
      <span aria-hidden="true">
        {counts.total} {counts.total === 1 ? "comment" : "comments"}
        {counts.newCount > 0 && ` · ${counts.newCount} new`}
        {showUnanswered && counts.unanswered > 0 && ` · ${counts.unanswered} unanswered`}
      </span>
    </span>
  );
}

function LessonRow({
  slug,
  lesson,
  completed,
  canOpen,
  current,
  previewComingSoon,
  counts,
  showUnanswered,
}: {
  slug: string;
  lesson: OutlineLesson;
  completed: boolean;
  canOpen: boolean;
  current: boolean;
  previewComingSoon?: boolean;
  counts?: LessonCommentCounts;
  showUnanswered?: boolean;
}) {
  const duration = formatDuration(lesson.duration_seconds);
  // Not released yet: "Coming soon", or (only staff ever get these) a Kajabi draft.
  const comingSoon = lesson.state !== "open";
  const thumbnail = courseImageUrl(lesson.thumbnail_url);
  const content = (
    <>
      <span aria-hidden="true" className="aspect-video w-24 shrink-0 overflow-hidden rounded bg-plum-50 @pair:w-32 dark:bg-slate-800">
        {thumbnail && (
          // Decorative (the title is beside it); a plain img so any Kajabi image host works.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 text-sm ${current ? "font-semibold" : "font-medium"}`}>
          <Icon name={lesson.quiz ? "quiz" : "video"} className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span className="sr-only">{lesson.quiz ? "Quiz: " : "Video: "}</span>
          {lesson.title}
        </span>
        {completed && <span className="sr-only"> (completed)</span>}
        {lesson.excerpt && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600 dark:text-slate-400">{lesson.excerpt}</span>}
        {comingSoon ? (
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">{unreleasedLabel(lesson.state)}</span>
        ) : (
          <span className="block">
            {duration && <span className="mt-1 inline-block text-xs text-slate-600 dark:text-slate-400">{duration}</span>}
            {counts && counts.total > 0 && <CommentBadge counts={counts} showUnanswered={showUnanswered} />}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
          completed ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 dark:border-slate-600"
        }`}
      >
        {completed ? "✓" : ""}
      </span>
    </>
  );
  const base = "flex items-center gap-3 rounded-lg p-2";
  if ((comingSoon && !previewComingSoon) || !canOpen) {
    return <li className={`${base} text-slate-600 dark:text-slate-400`}>{content}</li>;
  }
  return (
    <li>
      <Link
        href={`/courses/${slug}/lessons/${lesson.id}`}
        data-track="course-outline-lesson"
        aria-current={current ? "page" : undefined}
        className={`${base} hover:bg-slate-50 dark:hover:bg-slate-800 ${current ? "bg-plum-50 text-plum-900 dark:bg-slate-800 dark:text-slate-100" : ""}`}
      >
        {content}
      </Link>
    </li>
  );
}

function ModuleNode({ node, depth, ...rest }: { node: OutlineNode; depth: number } & Omit<Props, "outline">) {
  const comingSoon = node.module.state !== "open";
  const Heading = depth === 0 ? "h2" : "h3";
  const body = (
    <>
      <Heading className={`flex items-center gap-2 ${depth === 0 ? "text-lg font-semibold" : "text-base font-semibold"}`}>
        {node.module.title}
        {comingSoon && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-400">{unreleasedLabel(node.module.state)}</span>
        )}
      </Heading>
      <ul className="mt-2 space-y-1">
        {node.lessons.map((lesson) => (
          <LessonRow
            key={lesson.id}
            slug={rest.slug}
            lesson={lesson}
            completed={rest.completed.has(lesson.id)}
            canOpen={rest.canOpen}
            current={lesson.id === rest.currentLessonId}
            previewComingSoon={rest.previewComingSoon}
            counts={rest.commentCounts?.get(lesson.id)}
            showUnanswered={rest.showUnanswered}
          />
        ))}
      </ul>
      {node.children.map((child) => (
        <ModuleNode key={child.module.id} node={child} depth={depth + 1} {...rest} />
      ))}
    </>
  );
  // A top-level module is a card; its weeks sit inside it.
  return depth === 0 ? (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">{body}</section>
  ) : (
    <section className="mt-5">{body}</section>
  );
}

/** A course's modules, weeks and lessons: checkmarks, durations, and "Coming soon" for unreleased ones. */
export default function CourseOutline({ slug, outline, completed, canOpen, currentLessonId, previewComingSoon, commentCounts, showUnanswered }: Props) {
  return (
    <nav aria-label="Course outline" className="@container space-y-4">
      {outline.loose.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {outline.loose.map((lesson) => (
            <LessonRow
              key={lesson.id}
              slug={slug}
              lesson={lesson}
              completed={completed.has(lesson.id)}
              canOpen={canOpen}
              current={lesson.id === currentLessonId}
              previewComingSoon={previewComingSoon}
              counts={commentCounts?.get(lesson.id)}
              showUnanswered={showUnanswered}
            />
          ))}
        </ul>
      )}
      {outline.modules.map((node) => (
        <ModuleNode
          key={node.module.id}
          node={node}
          depth={0}
          slug={slug}
          completed={completed}
          canOpen={canOpen}
          currentLessonId={currentLessonId}
          previewComingSoon={previewComingSoon}
          commentCounts={commentCounts}
          showUnanswered={showUnanswered}
        />
      ))}
    </nav>
  );
}
