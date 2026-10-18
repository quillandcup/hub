// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
const clearUnownedBrowserPush = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-push", () => ({ clearUnownedBrowserPush }));
import { BrowserPushAccountGuard } from "@/components/BrowserPushAccountGuard";
beforeEach(() => { clearUnownedBrowserPush.mockReset().mockResolvedValue(undefined); });
it("checks ownership again when the member changes", () => {
  const { rerender } = render(<BrowserPushAccountGuard memberId="m1" isSudo={false} />);
  rerender(<BrowserPushAccountGuard memberId="m2" isSudo={false} />);
  expect(clearUnownedBrowserPush).toHaveBeenCalledTimes(2);
});
it("leaves the admin's own browser untouched in sudo", () => {
  render(<BrowserPushAccountGuard memberId="m1" isSudo />);
  expect(clearUnownedBrowserPush).not.toHaveBeenCalled();
});
it("handles a failed browser lookup without breaking the page", async () => {
  clearUnownedBrowserPush.mockRejectedValue(new Error("unavailable"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<BrowserPushAccountGuard memberId="m1" isSudo={false} />);
  await waitFor(() => expect(error).toHaveBeenCalled());
  error.mockRestore();
});
