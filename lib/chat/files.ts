/** A file on a chat message, as stored in chat_message_contents.files. */
export interface ChatFile {
  /** The Slack file id (also the name of its folder in the slack-files bucket). */
  id: string;
  name: string | null;
  mimetype: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  /**
   * Where the bytes wait in the private bucket while the message is still being sent (its id is
   * then 'pending-...'). Never sent to the browser: only parseChatFiles(raw, { staged: true }) keeps it.
   */
  staged?: string | null;
}

/** A file's id until Slack has it. */
export const PENDING_FILE_PREFIX = "pending-";

/** Image types a browser shows in an <img>; everything else is offered as a download. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export function isInlineImage(file: Pick<ChatFile, "mimetype">): boolean {
  return INLINE_IMAGE_TYPES.has((file.mimetype ?? "").toLowerCase());
}

/** Read the stored list defensively: it comes from jsonb written by SQL, Slack payloads and the Hub. */
export function parseChatFiles(raw: unknown, opts: { staged?: boolean } = {}): ChatFile[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const files: ChatFile[] = [];
  for (const f of raw) {
    const id = str(f?.id);
    if (!id) continue;
    const file: ChatFile = { id, name: str(f.name), mimetype: str(f.mimetype), size: num(f.size), width: num(f.width), height: num(f.height) };
    if (opts.staged) file.staged = str(f.staged);
    files.push(file);
  }
  return files;
}

export function chatFileUrl(messageId: string, fileId: string): string {
  return `/api/chat/files/${encodeURIComponent(messageId)}/${encodeURIComponent(fileId)}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
