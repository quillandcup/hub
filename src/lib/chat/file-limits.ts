/**
 * Where chat files are stored and how big one may be. Client safe (no server imports). The bucket still carries the name it was
 * created with, when the files all came from Slack ("slack-files"); renaming it is a storage move, not a code change, so the
 * name is kept and this constant is the one place core says it (the Slack capture code derives its own constants from it).
 */
export const CHAT_FILES_BUCKET = "slack-files";

/** Larger files stay with the transport only: the function holds each file in memory. */
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
