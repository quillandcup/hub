import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectSlackActivity } from "@/lib/slack-activity-projection";

const rpc = vi.fn();
const supabase = { rpc } as never;

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("projectSlackActivity", () => {
  it("asks for one message's activities and returns the counts", async () => {
    rpc.mockResolvedValue({ data: { messages: 1, reactions: 2 }, error: null });
    await expect(projectSlackActivity(supabase, "C1", "100.1")).resolves.toEqual({ messages: 1, reactions: 2 });
    expect(rpc).toHaveBeenCalledWith("slack_activity_project_message", { p_channel_id: "C1", p_message_ts: "100.1" });
  });

  it("counts nothing when the database answers with nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(projectSlackActivity(supabase, "C1", "100.1")).resolves.toEqual({ messages: 0, reactions: 0 });
  });

  it("says it failed, without throwing, so a failure can't fail the webhook (the next rebuild fixes the row)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "canceling statement due to statement timeout" } });
    await expect(projectSlackActivity(supabase, "C1", "100.1")).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
