import { safeUrl } from "@/lib/url";

// The part of the course images code a page needs to put an image in an <img>. Kept apart from the copy step
// (src/lib/courses/images.ts, which reaches the media library and so image processing) because client components
// import it, and must not pull the server side into the browser bundle.

const COURSE_IMAGE_PREFIX = "/api/courses/image/";

/**
 * The only paths on this site an `<img src>` in stored lesson HTML may point at: our course image route and the media
 * library route. Both only read an image. Anything else on this site (an API route, a page) is dropped by the lesson
 * sanitizer, so staff-authored HTML cannot make a member's browser request an arbitrary path (docs/trust/THREAT_MODEL.md, A03).
 */
export const IMAGE_ROUTE_PREFIXES = [COURSE_IMAGE_PREFIX, "/api/media/"] as const;

export type CourseImageKind = "course" | "hero" | "module" | "lesson";

/**
 * The URL a page puts in an `<img>`: our copy when it exists (`copy` is the row's library asset id), the Kajabi URL
 * until the copy step has run.
 */
export function courseImageSrc(kind: CourseImageKind, id: string, copy: string | null | undefined, fallbackUrl: string | null | undefined): string | null {
  if (copy) return `${COURSE_IMAGE_PREFIX}${kind}/${id}`;
  return safeUrl(fallbackUrl);
}

/** For an `<img src>`: one of our own image paths, or an http(s) URL; anything else is dropped. */
export function courseImageUrl(url: string | null | undefined): string | null {
  return url?.startsWith(COURSE_IMAGE_PREFIX) ? url : safeUrl(url);
}
