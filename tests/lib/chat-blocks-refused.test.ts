import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException, sendOperationsAlert } = vi.hoisted(() => ({ captureException: vi.fn(), sendOperationsAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: (...args: unknown[]) => sendOperationsAlert(...args) }));

import { reportRefusedBlocks } from "@/lib/chat/blocks-refused";

const repos = { rateLimit: {} } as never;
const refusal = { data: { error: "invalid_blocks" } };

beforeEach(() => {
  captureException.mockReset();
  sendOperationsAlert.mockReset();
});

describe("reportRefusedBlocks", () => {
  it("sends Sentry the error with the message id (tagged by where), and the staff channel an alert without it", async () => {
    await reportRefusedBlocks(repos, "post", "msg_AAAAAAAAAAA1", refusal);
    expect(captureException).toHaveBeenCalledWith(refusal, { tags: { chat_blocks_refused: "post" }, extra: { messageId: "msg_AAAAAAAAAAA1" } });
    expect(sendOperationsAlert).toHaveBeenCalledWith(repos, { type: "slack_blocks_refused", where: "post" });
  });

  it("never throws into the send path, even when reporting fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendOperationsAlert.mockRejectedValueOnce(new Error("alerts down"));
    await expect(reportRefusedBlocks(repos, "upload", "m1", refusal)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    captureException.mockImplementationOnce(() => {
      throw new Error("sentry down");
    });
    await expect(reportRefusedBlocks(repos, "edit", "m1", refusal)).resolves.toBeUndefined();
    error.mockRestore();
  });
});
