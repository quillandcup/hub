import { describe, it, expect } from "vitest";
import { parseChatMessage } from "@/lib/zoom-chat";

const chatEvent = (chat: Record<string, unknown>, object: Record<string, unknown> = {}) => ({
  event: "meeting.chat_message_sent",
  event_ts: 1791198000000,
  payload: {
    account_id: "acct",
    object: {
      id: 123456789,
      uuid: "meeting-uuid-1",
      chat_message: {
        date_time: "2026-10-05T11:02:00Z",
        message_id: "msg-1",
        message_content: "Hello & <welcome>",
        sender_name: "Ada Example",
        sender_email: "ada@example.test",
        sender_session_id: "session-1",
        sender_type: "guest",
        sender_context: "meeting",
        recipient_type: "everyone",
        recipient_context: "meeting",
        ...chat,
      },
      ...object,
    },
  },
});

describe("parseChatMessage", () => {
  it("maps a public message, keeping the text as sent and the whole payload", () => {
    const payload = chatEvent({});
    expect(parseChatMessage(payload)).toEqual({
      meeting_uuid: "meeting-uuid-1",
      meeting_id: "123456789",
      breakout_room_uuid: null,
      message_id: "msg-1",
      sent_at: "2026-10-05T11:02:00.000Z",
      sender_name: "Ada Example",
      sender_email: "ada@example.test",
      sender_session_id: "session-1",
      sender_type: "guest",
      sender_context: "meeting",
      recipient_type: "everyone",
      recipient_context: "meeting",
      recipient_session_id: null,
      recipient_name: null,
      recipient_email: null,
      message_text: "Hello & <welcome>",
      has_files: false,
      raw_payload: payload,
    });
  });

  it("keeps who a private message went to, a breakout room and attached files", () => {
    const row = parseChatMessage(
      chatEvent(
        { recipient_type: "guest", recipient_name: "Bea Example", recipient_email: "bea@example.test", recipient_session_id: "s2", file_ids: ["f1"] },
        { breakout_room_uuid: "room-1" }
      )
    );
    expect(row).toMatchObject({
      recipient_type: "guest",
      recipient_name: "Bea Example",
      recipient_email: "bea@example.test",
      recipient_session_id: "s2",
      breakout_room_uuid: "room-1",
      has_files: true,
    });
  });

  it("treats a missing sender email or an empty one as unknown, and missing content as empty", () => {
    const row = parseChatMessage(chatEvent({ sender_email: "", message_content: undefined }));
    expect(row?.sender_email).toBeNull();
    expect(row?.message_text).toBe("");
  });

  it("falls back to the event timestamp when the message has no time", () => {
    expect(parseChatMessage(chatEvent({ date_time: undefined }))?.sent_at).toBe(new Date(1791198000000).toISOString());
  });

  it("returns null for other events and for payloads missing the meeting, the message id or a usable time", () => {
    expect(parseChatMessage({ ...chatEvent({}), event: "meeting.participant_joined" })).toBeNull();
    expect(parseChatMessage(chatEvent({ message_id: undefined }))).toBeNull();
    expect(parseChatMessage(chatEvent({}, { uuid: undefined }))).toBeNull();
    expect(parseChatMessage(chatEvent({ date_time: "not a date" }))).toBeNull();
    expect(parseChatMessage({ event: "meeting.chat_message_sent", payload: { object: { uuid: "u" } } })).toBeNull();
    expect(parseChatMessage(null)).toBeNull();
  });
});
