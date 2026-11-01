import { safeUrl } from "@/lib/url";

// The part of the course images code a page needs to put an image in an <img>. Kept apart from the copy step
// (lib/courses/images.ts, which reaches the media library and so image processing) because client components
// import it, and must not pull the server side into the browser bundle.

export type CourseImageKind = "course" | "hero" | "module" | "lesson";

/**
 * The URL a page puts in an `<img>`: our copy when it exists (`copy` is the row's library asset id), the Kajabi URL
 * until the copy step has run.
 */
export function courseImageSrc(kind: CourseImageKind, id: string, copy: string | null | undefined, fallbackUrl: string | null | undefined): string | null {
  if (copy) return `/api/courses/image/${kind}/${id}`;
  return safeUrl(fallbackUrl);
}

/** For an `<img src>`: one of our own image paths, or an http(s) URL; anything else is dropped. */
export function courseImageUrl(url: string | null | undefined): string | null {
  return url?.startsWith("/api/courses/image/") ? url : safeUrl(url);
}
