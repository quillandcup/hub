import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { APP_URL } from "@/lib/config";
import { isId } from "@/lib/ids";
import { lessonPath } from "@/lib/courses/preview-path";
import { publicLessonPreview } from "@/lib/courses/public-preview";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";

type Params = { params: Promise<{ slug: string; lessonId: string }> };

/** One read per render, shared by the page and its metadata. Null unless the lesson is public (lib/courses/public-preview.ts). */
const loadPreview = cache(async (slug: string, lessonId: string) => {
  const result = await publicLessonPreview(createRepos(createServiceRoleClient()), lessonId, { slug });
  return "preview" in result ? result.preview : null;
});

const absolute = (src: string) => (src.startsWith("/") ? `${APP_URL}${src}` : src);

/**
 * What a signed-out visitor, a link unfurler (Slack, iMessage) or a social card sees for a lesson
 * address. The proxy rewrites signed-out visits to `/courses/<course>/lessons/<lesson>` here
 * (lib/courses/preview-path.ts); this page is not linked anywhere itself.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, lessonId } = await params;
  if (!isId(lessonId, "les")) return { title: "Login" };
  const preview = await loadPreview(slug, lessonId);
  if (!preview) return { title: "Login" };

  const title = `${preview.title} · ${preview.courseTitle}`;
  const description = preview.excerpt ?? `A lesson in ${preview.courseTitle}. Sign in to watch.`;
  const images = preview.thumbnailSrc ? [{ url: absolute(preview.thumbnailSrc), alt: preview.title }] : undefined;
  return {
    title,
    description,
    // Not for search engines (these are lessons of a members' course); link unfurlers ignore this.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "article", url: `${APP_URL}${lessonPath(slug, lessonId)}`, images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default async function LessonPreviewPage({ params }: Params) {
  const { slug, lessonId } = await params;
  if (!isId(lessonId, "les")) notFound();
  // Someone who is signed in belongs on the lesson itself.
  if (await getCurrentUser()) redirect(lessonPath(slug, lessonId));
  const preview = await loadPreview(slug, lessonId);
  // Not public (coming soon, a draft, an unknown lesson, the feature off): the login page, as before. The proxy has already remembered where they were headed.
  if (!preview) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <div className="overflow-hidden rounded-2xl bg-white shadow dark:bg-slate-900">
        {preview.thumbnailSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.thumbnailSrc} alt="" className="aspect-video w-full object-cover" />
        )}
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-plum-700 dark:text-plum-300">{preview.courseTitle}</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{preview.title}</h1>
          {preview.excerpt && <p className="mt-3 text-slate-600 dark:text-slate-300">{preview.excerpt}</p>}
          <Link href="/login" data-track="lesson-preview-sign-in" className="mt-6 inline-block rounded bg-plum-600 px-5 py-2.5 font-medium text-white hover:bg-plum-700">
            Sign in to watch
          </Link>
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">This lesson is part of a course for members.</p>
        </div>
      </div>
    </main>
  );
}
