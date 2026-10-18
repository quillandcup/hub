// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
const syncBrowserPush = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-push", () => ({ syncBrowserPush }));
import { BrowserPushAccountGuard } from "@/components/BrowserPushAccountGuard";
beforeEach(() => { syncBrowserPush.mockReset().mockResolvedValue(undefined); });
it("checks ownership again when the member changes", () => {
  const { rerender } = render(<BrowserPushAccountGuard memberId="m1" isSudo={false} publicKey="AAAA" />);
  rerender(<BrowserPushAccountGuard memberId="m2" isSudo={false} publicKey="AAAA" />);
  expect(syncBrowserPush).toHaveBeenCalledTimes(2);
});
it("leaves the admin's own browser untouched in sudo", () => {
  render(<BrowserPushAccountGuard memberId="m1" isSudo publicKey="AAAA" />);
  expect(syncBrowserPush).not.toHaveBeenCalled();
});
it("handles a failed browser lookup without breaking the page", async () => {
  syncBrowserPush.mockRejectedValue(new Error("unavailable"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<BrowserPushAccountGuard memberId="m1" isSudo={false} publicKey="AAAA" />);
  await waitFor(() => expect(error).toHaveBeenCalled());
  error.mockRestore();
});
