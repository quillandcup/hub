/** A file on a chat message, as stored in chat_message_contents.files. */
export interface ChatFile {
  /** The Slack file id (also the name of its folder in the slack-files bucket). */
  id: string;
  name: string | null;
  mimetype: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

/** Image types a browser shows in an <img>; everything else is offered as a download. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export function isInlineImage(file: Pick<ChatFile, "mimetype">): boolean {
  return INLINE_IMAGE_TYPES.has((file.mimetype ?? "").toLowerCase());
}

/** Read the stored list defensively: it comes from jsonb written by SQL, Slack payloads and the Hub. */
export function parseChatFiles(raw: unknown): ChatFile[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const files: ChatFile[] = [];
  for (const f of raw) {
    const id = str(f?.id);
    if (!id) continue;
    files.push({ id, name: str(f.name), mimetype: str(f.mimetype), size: num(f.size), width: num(f.width), height: num(f.height) });
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
