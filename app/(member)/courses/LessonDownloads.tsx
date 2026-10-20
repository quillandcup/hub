import { formatBytes } from "@/lib/courses/files";
import type { LessonFileView } from "@/lib/courses/member";

/** The lesson's downloads. Each link goes through the access-checked download route. */
export default function LessonDownloads({ slug, lessonId, files }: { slug: string; lessonId: string; files: LessonFileView[] }) {
  if (files.length === 0) return null;
  return (
    <section aria-label="Downloads" className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-semibold">Downloads</h2>
      <ul className="mt-3 space-y-2">
        {files.map((file) => {
          const size = formatBytes(file.size_bytes);
          return (
            <li key={file.id}>
              <a
                href={`/courses/${slug}/lessons/${lessonId}/files/${file.id}`}
                data-track="lesson-download-file"
                className="flex items-start gap-2 text-sm text-plum-700 hover:underline dark:text-plum-300"
              >
                <span aria-hidden="true">📄</span>
                <span className="min-w-0 break-words">
                  {file.filename}
                  {size && (
                    <>
                      {" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">({size})</span>
                    </>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
