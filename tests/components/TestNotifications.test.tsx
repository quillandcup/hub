// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHANNELS } from "@/lib/channels/catalog";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";

const sendTestNotification = vi.fn();
vi.mock("@/app/(admin)/admin/notifications/actions", () => ({ sendTestNotification: (...args: unknown[]) => sendTestNotification(...args) }));

import TestNotifications from "@/app/(admin)/admin/notifications/TestNotifications";

beforeEach(() => {
  sendTestNotification.mockResolvedValue({ success: true, sent: 1 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TestNotifications", () => {
  it("has a send button for every notification on every channel", () => {
    render(<TestNotifications />);

    expect(screen.getAllByRole("button", { name: /^Send .* by / })).toHaveLength(NOTIFICATION_KINDS.length * CHANNELS.length);
  });

  it("sends the one notification on the one channel, and shows it went", async () => {
    render(<TestNotifications />);

    await userEvent.click(screen.getByRole("button", { name: "Send Introduction reminders by Slack" }));

    expect(sendTestNotification).toHaveBeenCalledExactlyOnceWith("intro_nudge", "slack");
    expect(await screen.findByRole("status")).toHaveTextContent("✓ Sent");
  });

  it("shows why a channel couldn't send, beside its button", async () => {
    sendTestNotification.mockResolvedValue({ error: "Your member record has no email address." });
    render(<TestNotifications />);

    await userEvent.click(screen.getByRole("button", { name: "Send Prickle reminders by Email" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Your member record has no email address.");
  });

  it("sends a notification on every channel from its row", async () => {
    render(<TestNotifications />);

    await userEvent.click(screen.getByRole("button", { name: "Send Prickle check-ins on every channel" }));

    expect(sendTestNotification.mock.calls.map(([, channel]) => channel)).toEqual(CHANNELS.map((c) => c.id));
    expect(sendTestNotification.mock.calls.every(([kind]) => kind === "prickle_checkin")).toBe(true);
  });
});
