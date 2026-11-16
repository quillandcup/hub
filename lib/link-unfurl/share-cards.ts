import { APP_URL } from "@/lib/config";
import { coursePath, coursePreviewRewrite, lessonPath, lessonPreviewRewrite } from "@/lib/courses/preview-path";
import type { PublicCoursePreview, PublicLessonPreview, ShareImageSize } from "@/lib/courses/public-preview";
import { documentTitle, PUBLIC_PAGE_TITLES, SITE_DESCRIPTION } from "@/lib/page-title";

/**
 * What a link to a PUBLIC page of the Hub shows when it is shared: one description of the card, built here and used twice, so the two cannot
 * drift. The page's own `generateMetadata` (Open Graph and Twitter tags, read by link crawlers) and the Slack app's answer to `link_shared`
 * (lib/chat/slack-link-unfurl.ts, which replaces the crawler for the Hub's host) both read a `ShareCard`.
 *
 * Which pages are public and what each one does about this is listed in `PUBLIC_ROUTES` below, and `tests/lib/public-share-cards.test.ts`
 * fails when an app route outside the member and admin areas is missing from it.
 */

export interface ShareCard {
  title: string;
  description: string;
  /** Absolute address of the picture (a relative address of ours is made absolute), or null. Slack fetches it, so it must be public. */
  imageUrl: string | null;
  imageSize: ShareImageSize | null;
  /** The page's own address. */
  url: string;
  /** `article` for a lesson, `website` otherwise (the Open Graph type). */
  type: "article" | "website";
}

const absolute = (src: string) => (src.startsWith("/") ? `${APP_URL}${src}` : src);

export function lessonShareCard(preview: PublicLessonPreview): ShareCard {
  return {
    title: `${preview.title} · ${preview.courseTitle}`,
    description: preview.excerpt ?? `A lesson in ${preview.courseTitle}. Sign in to watch.`,
    imageUrl: preview.thumbnailSrc ? absolute(preview.thumbnailSrc) : null,
    imageSize: preview.thumbnailSize,
    url: `${APP_URL}${lessonPath(preview.courseSlug, preview.lessonId)}`,
    type: "article",
  };
}

export function courseShareCard(preview: PublicCoursePreview): ShareCard {
  return {
    title: preview.title,
    description: preview.excerpt ?? `${preview.title}, a course for Quill & Cup members. Sign in to open it.`,
    imageUrl: preview.thumbnailSrc ? absolute(preview.thumbnailSrc) : null,
    imageSize: preview.thumbnailSize,
    url: `${APP_URL}${coursePath(preview.slug)}`,
    type: "website",
  };
}

/** The site's own card (`app/opengraph-image.jpg`, which the root layout's metadata points every page at), under a page's title. */
export function siteShareCard(pathname: string, pageTitle: string): ShareCard {
  return {
    title: documentTitle(pageTitle),
    description: SITE_DESCRIPTION,
    imageUrl: `${APP_URL}/opengraph-image.jpg`,
    imageSize: { width: 1200, height: 630 },
    url: `${APP_URL}${pathname}`,
    type: "website",
  };
}

/** Next's `Metadata` for a page whose card this is. */
export function shareCardMetadata(card: ShareCard) {
  const images = card.imageUrl ? [{ url: card.imageUrl, alt: card.title, ...(card.imageSize ?? {}) }] : undefined;
  return {
    title: card.title,
    description: card.description,
    openGraph: { title: card.title, description: card.description, type: card.type, url: card.url, images },
    twitter: { card: images ? ("summary_large_image" as const) : ("summary" as const), title: card.title, description: card.description, images: images?.map((i) => i.url) },
  };
}

/**
 * Every page outside the member and admin areas, with what the Slack app does for a link to it. `card` pages are answered with the same
 * Open Graph card their metadata gives; `none` pages are left as plain links (no card from the app), each with its reason. A new public
 * page must be added here on purpose.
 */
export const PUBLIC_ROUTES: Record<string, { slack: "card" | "none"; reason: string }> = {
  "app/page.tsx": { slack: "card", reason: "redirects to the login page; the site card, as the crawler showed it" },
  "app/login/page.tsx": { slack: "card", reason: "the site card under the page title" },
  "app/privacy/page.tsx": { slack: "card", reason: "the site card under the page title" },
  "app/course-preview/[slug]/page.tsx": { slack: "card", reason: "a public course: its own title, description and cover (reached at /courses/<slug> when signed out)" },
  "app/lesson-preview/[slug]/[lessonId]/page.tsx": { slack: "card", reason: "a public lesson: its own title, teaser and thumbnail (reached at /courses/<slug>/lessons/<id> when signed out)" },
  "app/unsubscribe/page.tsx": { slack: "none", reason: "a per-member token link from an email; nothing worth a card" },
  "app/verify-email/page.tsx": { slack: "none", reason: "a per-member confirmation link; nothing to show" },
  "app/no-access/page.tsx": { slack: "none", reason: "a page for a signed-in member who may not enter; never shared" },
  "app/auth/slack/continue/page.tsx": { slack: "none", reason: "carries a one-time sign-in token; no card is made from it" },
};

/** Which public page a link's path is, among those that get a card; null for everything else on the host. */
export type PublicTarget = { kind: "lesson"; slug: string; lessonId: string } | { kind: "course"; slug: string } | { kind: "site"; pathname: string; title: string };

export function publicTarget(pathname: string): PublicTarget | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const lesson = lessonPreviewRewrite(path)?.match(/^\/lesson-preview\/([^/]+)\/([^/]+)$/);
  if (lesson) return { kind: "lesson", slug: lesson[1], lessonId: lesson[2] };
  const course = coursePreviewRewrite(path)?.match(/^\/course-preview\/([^/]+)$/);
  if (course) return { kind: "course", slug: course[1] };
  if (path === "/" || path === "/login") return { kind: "site", pathname: path, title: PUBLIC_PAGE_TITLES.login };
  if (path === "/privacy") return { kind: "site", pathname: path, title: PUBLIC_PAGE_TITLES.privacy };
  return null;
}
