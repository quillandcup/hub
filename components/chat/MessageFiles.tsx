import { chatFileUrl, formatFileSize, isInlineImage, type ChatFile } from "@/lib/chat/files";

/** A message's files: images (and GIFs) inline, the rest as download chips. */
export default function MessageFiles({ messageId, files }: { messageId: string; files: ChatFile[] }) {
  if (files.length === 0) return null;
  const images = files.filter(isInlineImage);
  const others = files.filter((f) => !isInlineImage(f));
  return (
    <div className="mt-1.5 flex flex-col gap-2" data-testid="message-files">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <a
              key={f.id}
              href={chatFileUrl(messageId, f.id)}
              target="_blank"
              rel="noopener noreferrer"
              data-track="chat-file-open"
              className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served through the access-checked chat files route, not an optimizable asset */}
              <img
                src={chatFileUrl(messageId, f.id)}
                alt={f.name ?? "Image"}
                width={f.width ?? undefined}
                height={f.height ?? undefined}
                loading="lazy"
                className="block h-auto max-h-80 w-auto max-w-full"
              />
            </a>
          ))}
        </div>
      )}
      {others.map((f) => (
        <a
          key={f.id}
          href={chatFileUrl(messageId, f.id)}
          download={f.name ?? undefined}
          data-track="chat-file-download"
          className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true">📎</span>
          <span className="truncate">{f.name ?? "File"}</span>
          {f.size !== null && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatFileSize(f.size)}</span>}
        </a>
      ))}
    </div>
  );
}
