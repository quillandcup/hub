import type { NewZoomChatMessage } from "@/lib/data/zoom";

/**
 * Zoom in-meeting chat from the `meeting.chat_message_sent` webhook (bronze.zoom_chat_messages, migration
 * 20270625000000). Zoom's only pull path for chat is the CHAT file of a cloud recording, which few prickles
 * have, so this webhook is the only source for most meetings (docs/TODO.md, "Zoom in-meeting chat").
 */

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * The row to record for a chat message webhook, or null for any other event or a payload missing what the
 * row needs (meeting, message id, time). The message's own time is used, falling back to Zoom's event
 * timestamp. Everything Zoom sent is kept in `raw_payload`; the columns are what reads need.
 */
export function parseChatMessage(payload: any): NewZoomChatMessage | null {
  if (payload?.event !== "meeting.chat_message_sent") return null;
  const meeting = payload.payload?.object;
  const chat = meeting?.chat_message;
  if (!meeting?.uuid || !chat?.message_id) return null;

  const rawTime = chat.date_time ?? payload.event_ts;
  const sentAt = typeof rawTime === "number" ? new Date(rawTime) : new Date(String(rawTime ?? ""));
  if (Number.isNaN(sentAt.getTime())) return null;

  return {
    meeting_uuid: String(meeting.uuid),
    meeting_id: meeting.id != null ? String(meeting.id) : null,
    breakout_room_uuid: text(meeting.breakout_room_uuid),
    message_id: String(chat.message_id),
    sent_at: sentAt.toISOString(),
    sender_name: text(chat.sender_name),
    sender_email: text(chat.sender_email),
    sender_session_id: text(chat.sender_session_id),
    sender_type: text(chat.sender_type),
    sender_context: text(chat.sender_context),
    recipient_type: text(chat.recipient_type),
    recipient_context: text(chat.recipient_context),
    recipient_session_id: text(chat.recipient_session_id),
    recipient_name: text(chat.recipient_name),
    recipient_email: text(chat.recipient_email),
    message_text: typeof chat.message_content === "string" ? chat.message_content : "",
    has_files: Array.isArray(chat.file_ids) && chat.file_ids.length > 0,
    raw_payload: payload,
  };
}
