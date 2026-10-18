// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const read = vi.fn();
const send = vi.fn();
vi.mock("@/lib/browser-push-diagnostics", () => ({ readPushDiagnostics: () => read(), sendBrowserAlertComparison: (...args: unknown[]) => send(...args) }));
import BrowserPushDiagnostics from "@/app/(admin)/admin/notifications/BrowserPushDiagnostics";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("BrowserPushDiagnostics", () => {
  it("sends either alert style and shows its ID so the user can match the click entry", async () => {
    send.mockResolvedValueOnce("standard-1").mockResolvedValueOnce("persistent-2");
    read.mockResolvedValue({ version: "click-diagnostics-v3", entries: [] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Send standard alert" }));
    expect(await screen.findByText("Sent standard alert [standard-1]")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send persistent alert" }));
    expect(await screen.findByText("Sent persistent alert [persistent-2]")).toBeInTheDocument();
    expect(send.mock.calls).toEqual([["standard"], ["persistent"]]);
  });

  it("reports a failed comparison without leaving the previous alert ID on screen", async () => {
    send.mockResolvedValueOnce("standard-1").mockRejectedValueOnce(new Error("Notification permission denied"));
    read.mockResolvedValue({ version: "click-diagnostics-v3", entries: [] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Send standard alert" }));
    await screen.findByText("Sent standard alert [standard-1]");
    await userEvent.click(screen.getByRole("button", { name: "Send persistent alert" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Notification permission denied");
    expect(screen.queryByText("Sent standard alert [standard-1]")).not.toBeInTheDocument();
  });

  it("shows the active worker, correlated stages, sanitized messages, paths, and operations", async () => {
    read.mockResolvedValue({ version: "click-diagnostics-v3", entries: [
      { at: "2026-10-18T12:00:00Z", stage: "click_received", notificationId: "test-123" },
      { at: "2026-10-18T12:00:01Z", stage: "open_failed", notificationId: "test-123", error: "TypeError", errorMessage: "Window could not be opened", pathname: "/my-prickles/history", operation: "open_window", style: "persistent", version: "click-diagnostics-v3" },
    ] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh browser diagnostics" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Active worker: click-diagnostics-v3");
    expect(status).toHaveTextContent("Click reached the notification worker");
    expect(status).toHaveTextContent("Opening the notification failed (TypeError)");
    expect(status).toHaveTextContent("Window could not be opened");
    expect(status).toHaveTextContent("click-diagnostics-v3 · open_window · persistent · /my-prickles/history");
    expect(status).toHaveTextContent("Older worker");
    expect(screen.getAllByText("[test-123]")).toHaveLength(2);
  });
  it("explains when there are no recorded events", async () => {
    read.mockResolvedValue({ version: "click-diagnostics-v1", entries: [] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh browser diagnostics" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Send a new Browser test");
  });
  it("clears stale results when a refresh fails", async () => {
    read.mockResolvedValueOnce({ version: "click-diagnostics-v1", entries: [] }).mockRejectedValueOnce(new Error("Worker did not respond"));
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh browser diagnostics" }));
    await screen.findByRole("status");
    await userEvent.click(screen.getByRole("button", { name: "Refresh browser diagnostics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Worker did not respond");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
