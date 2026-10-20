import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCoursesPage } from "@/lib/courses/caller";
import { loadLessonView } from "@/lib/courses/member";
import { lessonContext, lessonSection, nextModuleLesson, type OutlineLesson } from "@/lib/courses/outline";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { courseTitle, lessonTitles } from "@/lib/courses/page-title";
import { isUuid } from "@/lib/chat/format";
import PageBanner from "@/components/PageBanner";
import LessonSectionList from "../../../LessonSectionList";
import LessonDownloads from "../../../LessonDownloads";
import LessonPlayer, { type PlaybackTokens } from "../../../LessonPlayer";
import { LessonCompletionProvider } from "../../../LessonCompletion";
import MarkCompleteButton from "../../../MarkCompleteButton";
import NextLessonPreview from "../../../NextLessonPreview";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; lessonId: string }> }): Promise<Metadata> {
  const { slug, lessonId } = await params;
  return { title: await courseTitle(slug, (outline) => lessonTitles(outline, lessonId)) };
}

/** Playback tokens, only for a ready video and only after the access check has passed. */
async function mintTokens(playbackId: string): Promise<PlaybackTokens | null> {
  try {
    return await signPlaybackTokens(createMuxClient(), playbackId);
  } catch (error) {
    console.error("Couldn't mint Mux playback tokens:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The lesson before or after this one: a card with its title, so the way on is clear without an outline. */
function NeighborCard({ slug, lesson, direction }: { slug: string; lesson: OutlineLesson; direction: "previous" | "next" }) {
  return (
    <Link
      href={`/courses/${slug}/lessons/${lesson.id}`}
      className={`group block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-plum-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-plum-700 ${
        direction === "next" ? "sm:text-right" : ""
      }`}
    >
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {direction === "previous" ? "← Previous" : "Next →"}
      </span>
      <span className="mt-1 block font-medium group-hover:text-plum-700 dark:group-hover:text-plum-300">{lesson.title}</span>
    </Link>
  );
}

/**
 * Back / Next right under the video (compact, so it works on a phone; disabled at the ends). Where the
 * section's lessons sit beside the video they are the way to move around, so these hide there
 * (`hideOnWide`) and only show once that list is gone.
 */
function StepButtons({ slug, previous, next, hideOnWide }: { slug: string; previous: OutlineLesson | null; next: OutlineLesson | null; hideOnWide: boolean }) {
  const base = "rounded-lg px-4 py-2 text-sm font-medium";
  const enabled = "bg-plum-600 text-white hover:bg-plum-700";
  const disabled = "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600";
  return (
    <div className={`mt-3 flex items-center justify-between gap-3 ${hideOnWide ? "lg:hidden" : ""}`}>
      {previous ? (
        <Link href={`/courses/${slug}/lessons/${previous.id}`} aria-label={`Back: ${previous.title}`} className={`${base} ${enabled}`}>
          ← Back
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} ${disabled}`}>
          ← Back
        </span>
      )}
      {next ? (
        <Link href={`/courses/${slug}/lessons/${next.id}`} aria-label={`Next: ${next.title}`} className={`${base} ${enabled}`}>
          Next →
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} ${disabled}`}>
          Next →
        </span>
      )}
    </div>
  );
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await params;
  if (!isUuid(lessonId)) notFound();
  const caller = await requireCoursesPage();
  const result = await loadLessonView(createServiceRoleClient(), slug, lessonId, caller.scope);

  if (result.kind === "not_found") notFound();
  // Lessons that can't be opened (no access, ended access, coming soon for members) go back to the course page, which says why.
  if (result.kind !== "ok") redirect(`/courses/${slug}`);

  const { view, lesson, neighbors, completed, video, preview, files } = result;

  let player: React.ReactNode = null;
  if (video) {
    const tokens = video.status === "ready" && video.playbackId ? await mintTokens(video.playbackId) : null;
    player =
      tokens && video.playbackId ? (
        <LessonPlayer title={lesson.title} playbackId={video.playbackId} tokens={tokens} posterUrl={lesson.thumbnail_url} />
      ) : (
        <p role="status" className="rounded-lg bg-slate-100 p-6 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {video.status === "errored" ? "This video couldn't be prepared. We've been told." : "This video is still being prepared. Check back soon."}
        </p>
      );
  }

  const context = lessonContext(view.outline, lesson.id);
  const section = lessonSection(view.outline, lesson.id);
  const nextModule = nextModuleLesson(view.outline, lesson.id, { includeComingSoon: caller.scope.isAdminActing });
  const sectionList = section && (
    <LessonSectionList
      slug={view.course.slug}
      section={section}
      completed={view.completed}
      currentLessonId={lesson.id}
      previewComingSoon={caller.scope.isAdminActing}
      nextModule={nextModule}
    />
  );
  // Completion can't be changed in sudo (read-only) or in a staff preview (progress isn't tracked there).
  const readOnlyReason = preview
    ? "Progress isn't tracked for lessons members can't open yet"
    : caller.identity.isSudo
      ? "Progress can't be changed while viewing as a member"
      : null;
  // The next lesson, with its thumbnail, for the "keep going" card once this one is complete.
  const nextLesson = neighbors.next && { id: neighbors.next.id, title: neighbors.next.title, thumbnail_url: neighbors.next.thumbnail_url };

  return (
    <>
      {preview && (
        <PageBanner>Preview: members see this lesson as &ldquo;Coming soon&rdquo; until it&apos;s published in Kajabi. Progress isn&apos;t tracked here.</PageBanner>
      )}

      <div className="mx-auto w-full max-w-screen-2xl px-6 py-6">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500 dark:text-slate-400">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li>
              <Link href={`/courses/${view.course.slug}`} className="hover:underline">
                {view.course.title}
              </Link>
            </li>
            {(context?.trail ?? []).map((crumb) => (
              <li key={crumb.id} className="flex gap-2">
                <span aria-hidden="true">/</span>
                <Link href={`/courses/${view.course.slug}/modules/${crumb.id}`} className="hover:underline">
                  {crumb.title}
                </Link>
              </li>
            ))}
            <li aria-current="page" className="flex gap-2 text-slate-900 dark:text-slate-100">
              <span aria-hidden="true">/</span>
              <span>{lesson.title}</span>
            </li>
          </ol>
        </nav>

        {/* Completion is shared by the player (which sets it at ~90% watched), the button and the next-lesson card. */}
        <LessonCompletionProvider lessonId={lesson.id} initiallyCompleted={completed} readOnlyReason={readOnlyReason}>
        <div className="mt-4 grid lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* The video and this section's lessons are one component: a dark panel flush against the player, the same height. */}
          {player && (
            <div className="overflow-hidden rounded-2xl bg-neutral-900 shadow-lg ring-1 ring-black/5 dark:ring-white/10 lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div>{player}</div>
              {sectionList && (
                <aside className="relative hidden lg:block">
                  <div className="absolute inset-0 overflow-y-auto">{sectionList}</div>
                </aside>
              )}
            </div>
          )}

          <div className="lg:col-start-1">
            <StepButtons slug={view.course.slug} previous={neighbors.previous} next={neighbors.next} hideOnWide={Boolean(player && sectionList)} />
          </div>

          {/* The main action, title and text sit together in one bounded card below the video and its controls, like the Downloads
              card beside it (and Kajabi's). Once the lesson is complete, a preview of the next lesson follows the button. */}
          <article className="mt-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900 lg:col-start-1 lg:row-start-3 lg:mr-8">
            <MarkCompleteButton />
            <NextLessonPreview slug={view.course.slug} next={nextLesson} />

            <h1 className="mt-8 text-3xl font-bold leading-tight">{lesson.title}</h1>

            {lesson.body_html && (
              // Sanitized with an allowlist when it was imported (lib/courses/sanitize.ts); never stored or rendered raw.
              <div className="prose prose-slate prose-lg mt-6 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: lesson.body_html }} />
            )}

            <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
              {(neighbors.previous || neighbors.next) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {neighbors.previous ? <NeighborCard slug={view.course.slug} lesson={neighbors.previous} direction="previous" /> : <span />}
                  {neighbors.next ? <NeighborCard slug={view.course.slug} lesson={neighbors.next} direction="next" /> : <span />}
                </div>
              )}
              <p className="mt-8 text-center text-sm">
                <Link href={`/courses/${view.course.slug}`} className="text-slate-500 underline hover:text-plum-700 dark:text-slate-400 dark:hover:text-plum-300">
                  View the full course outline
                </Link>
              </p>
            </div>
          </article>

          {/* Downloads: beside the text on a wide screen, after it on a phone ("available below"). The section list stands in for
              the player panel when a lesson has no video. */}
          {(files.length > 0 || (!player && sectionList)) && (
            <div className="mt-6 space-y-4 lg:col-start-2 lg:row-start-3">
              {!player && sectionList && <div className="hidden overflow-hidden rounded-2xl bg-neutral-900 lg:block">{sectionList}</div>}
              <LessonDownloads slug={view.course.slug} lessonId={lesson.id} files={files} />
            </div>
          )}
        </div>
        </LessonCompletionProvider>
      </div>
    </>
  );
}
