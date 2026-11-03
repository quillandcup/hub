import { describe, it, expect } from "vitest";
import { getTestSupabaseAdminClient } from "../helpers/supabase";
import { isInlineImage, parseChatFiles } from "@/lib/chat/files";

/**
 * The list of a message's files the Hub keeps is built from Slack's file objects. Slack's message_changed event
 * lists a file added in an edit as a stub (`mimetype: ""`, no picture size); it must still show as an inline image.
 */
describe("chat_slack_files_summary", () => {
  const supabase = getTestSupabaseAdminClient();
  const summary = async (files: unknown) => {
    const { data, error } = await supabase.rpc("chat_slack_files_summary", { p_files: files as never });
    expect(error).toBeNull();
    return parseChatFiles(data);
  };

  it("keeps a full file object's mimetype and picture size", async () => {
    const [file] = await summary([{ id: "F1", name: "a.png", mimetype: "image/png", size: 5, original_w: 512, original_h: 134 }]);
    expect(file).toMatchObject({ mimetype: "image/png", width: 512, height: 134 });
    expect(isInlineImage(file)).toBe(true);
  });

  it("guesses an image's mimetype from the filetype or the extension when Slack sent an empty one", async () => {
    const files = await summary([
      { id: "F1", name: "Screenshot 2026-11-03 at 5.58.20 AM.png", mimetype: "", size: 41564 },
      { id: "F2", name: "photo", filetype: "jpg", mimetype: "" },
      { id: "F3", name: "notes.pdf", mimetype: "" },
    ]);
    expect(files.map((f) => f.mimetype)).toEqual(["image/png", "image/jpeg", null]);
    expect(files.map(isInlineImage)).toEqual([true, true, false]);
  });
});
