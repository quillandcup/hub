// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const read = vi.fn();
vi.mock("@/lib/browser-push-diagnostics", () => ({ readPushDiagnostics: () => read() }));
import BrowserPushDiagnostics from "@/app/(admin)/admin/notifications/BrowserPushDiagnostics";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("BrowserPushDiagnostics", () => {
  it("shows the active worker, correlated stages, and error names", async () => {
    read.mockResolvedValue({ version: "click-diagnostics-v1", entries: [
      { at: "2026-10-18T12:00:00Z", stage: "click_received", notificationId: "test-123" },
      { at: "2026-10-18T12:00:01Z", stage: "open_failed", notificationId: "test-123", error: "TypeError" },
    ] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh browser diagnostics" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Active worker: click-diagnostics-v1");
    expect(status).toHaveTextContent("Click reached the notification worker");
    expect(status).toHaveTextContent("Opening the notification failed (TypeError)");
    expect(screen.getAllByText("[test-123]")).toHaveLength(2);
  });
  it("explains when there are no recorded events", async () => {
    read.mockResolvedValue({ version: "click-diagnostics-v1", entries: [] });
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent("Send a new Browser test");
  });
  it("clears stale results when a refresh fails", async () => {
    read.mockResolvedValueOnce({ version: "click-diagnostics-v1", entries: [] }).mockRejectedValueOnce(new Error("Worker did not respond"));
    render(<BrowserPushDiagnostics />);
    await userEvent.click(screen.getByRole("button"));
    await screen.findByRole("status");
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Worker did not respond");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
