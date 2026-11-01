import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminLesson, type AdminLessonDetail } from "@/lib/courses/admin";
import { formatCourseDateTime } from "@/lib/courses/format";
import CourseBuilderBanner from "../../../CourseBuilderBanner";
import type { PlaybackTokens } from "@/components/courses/LessonPlayer";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { formatClock } from "@/lib/courses/watch-stats";
import { APP_URL } from "@/lib/config";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { publicLessonPreview, type PreviewBlocker } from "@/lib/courses/public-preview";
import LessonStaffTools from "../../LessonStaffTools";
import LessonMediaPanel from "./LessonMediaPanel";
import VideoActions from "./VideoActions";
import LessonBuilderForm from "./LessonBuilderForm";
import LessonVideoControls from "./LessonVideoControls";
import { createRepos } from "@/lib/data/repos";

type Params = { params: Promise<{ id: string; lessonId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lessonId } = await params;
  const detail = await loadAdminLesson(createRepos(await createClient()), id, lessonId);
  // Most specific first: "Lesson · Course · Courses".
  return { title: [detail?.lesson.title, detail?.course.title, "Courses"].filter(Boolean).join(" · ") };
}

/** Playback tokens for a ready video; null (and logged) when Mux can't sign them. */
async function mintTokens(playbackId: string): Promise<PlaybackTokens | null> {
  try {
    return await signPlaybackTokens(createMuxClient(), playbackId);
  } catch (error) {
    console.error("Couldn't mint Mux playback tokens:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The lesson's video in the builder, played by the same player members get, with the Video actions menu. */
const BLOCKED_REASON: Record<PreviewBlocker | "no_thumbnail" | "not_in_hub", string> = {
  not_in_hub: "This lesson isn't in the Hub yet",
  not_found: "This lesson isn't in the Hub yet",
  not_open: "Only a lesson that is open to members has a public link",
  course_not_live: "The course hasn't opened yet",
  feature_off: "Courses aren't on for everyone yet",
  no_thumbnail: "This lesson has no thumbnail",
};

/** The address and picture to paste, when anyone could open the preview they lead to; otherwise why not. */
async function thumbnailLinkFor(detail: AdminLessonDetail, lessonUrl: string | null) {
  const { hub } = detail;
  if (!hub || !lessonUrl) return { link: null, blocked: BLOCKED_REASON.not_in_hub };
  const result = await publicLessonPreview(createRepos(createServiceRoleClient()), hub.lessonId);
  if ("blocked" in result) return { link: null, blocked: BLOCKED_REASON[result.blocked] };
  const { preview } = result;
  if (!preview.thumbnailSrc) return { link: null, blocked: BLOCKED_REASON.no_thumbnail };
  const imageUrl = preview.thumbnailSrc.startsWith("/") ? `${APP_URL}${preview.thumbnailSrc}` : preview.thumbnailSrc;
  return { link: { url: lessonUrl, imageUrl, title: preview.title }, blocked: "" };
}

/** What plays or says why not, and for a Hub-owned lesson the buttons that upload, replace or remove the video. */
async function lessonMedia(detail: AdminLessonDetail) {
  const media = await lessonPlayback(detail);
  if (!detail.editable) return media;
  return (
    <>
      {media}
      <LessonVideoControls courseId={detail.course.id} lessonId={detail.lesson.kajabiId} status={detail.video?.status ?? null} />
    </>
  );
}

async function lessonPlayback(detail: AdminLessonDetail) {
  const { lesson, video, hub, course } = detail;
  const note = "rounded border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400";
  const lessonUrl = hub ? `${APP_URL}/courses/${hub.slug}/lessons/${hub.lessonId}` : null;
  const statsHref = hub && video ? `/admin/courses/${course.id}/stats/${hub.lessonId}` : null;
  const { link: thumbnailLink, blocked: thumbnailLinkBlocked } = await thumbnailLinkFor(detail, lessonUrl);
  const actions = (
    <div className="mt-3">
      <VideoActions statsHref={statsHref} lessonUrl={lessonUrl} thumbnailLink={thumbnailLink} thumbnailLinkBlocked={thumbnailLinkBlocked} />
    </div>
  );
  if (video?.status === "ready" && video.playbackId) {
    const tokens = await mintTokens(video.playbackId);
    if (tokens) return <LessonMediaPanel title={lesson.title} playbackId={video.playbackId} tokens={tokens} posterUrl={lesson.thumbnailSrc} statsHref={statsHref} lessonUrl={lessonUrl} thumbnailLink={thumbnailLink} thumbnailLinkBlocked={thumbnailLinkBlocked} />;
    return (
      <>
        <p role="status" className={note}>The video can&apos;t be played right now.</p>
        {actions}
      </>
    );
  }
  if (video) {
    return (
      <>
        <p role="status" className={note}>{video.status === "errored" ? "This video couldn't be prepared." : "This video is still being prepared."}</p>
        {actions}
      </>
    );
  }
  if (lesson.hasVideo) {
    return (
      <>
        <p className={note}>
          This lesson has a video in Kajabi{lesson.videoDurationSeconds !== null && <> ({formatClock(lesson.videoDurationSeconds)})</>}
          {hub ? ", not in the Hub yet. It arrives with the next video step." : ". Publish the course to bring it into the Hub."}
        </p>
        {actions}
      </>
    );
  }
  return <p className={note}>No video on this lesson.</p>;
}

/** One lesson's builder page: the lesson as last imported from Kajabi, read only until the builder can save. */
export default async function AdminLessonPage({ params }: Params) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  const detail = await loadAdminLesson(createRepos(await createClient()), id, lessonId);
  if (!detail) notFound();
  const { course, lesson, hub } = detail;
  const media = await lessonMedia(detail);
  const path = hub ? `/courses/${hub.slug}/lessons/${hub.lessonId}` : null;

  return (
    <>
      <CourseBuilderBanner />
      <div className="@container container mx-auto max-w-6xl px-6 py-8">
        <Link href={`/admin/courses/${course.id}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← {course.title}
        </Link>
        <div className="mb-1 mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{lesson.title}</h1>
          <div className="flex items-center gap-2">
            {path && (
              <Link href={path} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600">
                Preview
              </Link>
            )}
            <button type="button" disabled className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
        {!detail.editable && <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">Last imported from Kajabi {formatCourseDateTime(lesson.fetchedAt)}.</p>}
        {hub && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white p-4 text-sm shadow dark:bg-slate-900">
            <span className="font-medium">Staff tools</span>
            <LessonStaffTools lessonId={hub.lessonId} lessonPath={path!} preview={lesson.state !== "open"} />
          </div>
        )}
        <LessonBuilderForm detail={detail} media={media} />
      </div>
    </>
  );
}
