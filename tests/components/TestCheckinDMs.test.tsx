// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendTestPrickleDM = vi.fn();
vi.mock("@/app/(admin)/admin/prickles/[id]/actions", () => ({
  sendTestPrickleDM: (...args: unknown[]) => sendTestPrickleDM(...args),
}));

import TestCheckinDMs from "@/app/(admin)/admin/prickles/[id]/TestCheckinDMs";

beforeEach(() => sendTestPrickleDM.mockReset());

async function sendCheckin() {
  render(<TestCheckinDMs prickleId="p1" />);
  await userEvent.click(screen.getByRole("button", { name: "Send me the check-in" }));
}

describe("TestCheckinDMs", () => {
  it("says which channels it went out on", async () => {
    sendTestPrickleDM.mockResolvedValue({ success: true, delivered: ["slack", "email"], skipped: [], failed: [] });
    await sendCheckin();
    expect(await screen.findByText("Sent the check-in by Slack and Email.")).toBeTruthy();
    expect(screen.queryByText(/Not sent by/)).toBeNull();
  });

  it("says why a channel was skipped when the member has no Slack match", async () => {
    sendTestPrickleDM.mockResolvedValue({ success: true, delivered: ["email"], skipped: ["slack"], failed: [] });
    await sendCheckin();
    expect(await screen.findByText("Sent the check-in by Email.")).toBeTruthy();
    expect(screen.getByText("Not sent by Slack: no Slack account is matched to your member record.")).toBeTruthy();
  });

  it("says when a channel had an address but the send failed", async () => {
    sendTestPrickleDM.mockResolvedValue({ success: true, delivered: ["email"], skipped: [], failed: ["slack"] });
    await sendCheckin();
    expect(await screen.findByText("Not sent by Slack: the send failed, see the server logs.")).toBeTruthy();
  });

  it("shows an error from the action", async () => {
    sendTestPrickleDM.mockResolvedValue({ error: "Nothing went out; check the server logs." });
    await sendCheckin();
    expect(await screen.findByText("Nothing went out; check the server logs.")).toBeTruthy();
  });
});
