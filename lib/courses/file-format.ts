// Pieces of the lesson downloads code a browser component may import (lib/courses/files.ts reaches for the server).

export const COURSE_FILES_BUCKET = "course-files";

/** "148 KB", "2.4 MB". */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
