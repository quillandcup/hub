// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

import RouteError from "@/components/RouteError";
import { SUPPORT_EMAIL } from "@/lib/config";

afterEach(() => {
  cleanup();
  captureException.mockReset();
});

describe("RouteError", () => {
  it("shows the digest of a server error and leaves reporting to the server", () => {
    render(<RouteError error={Object.assign(new Error("boom"), { digest: "1203344222" })} retry={() => {}} />);
    expect(screen.getByText("1203344222")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports an error raised in the browser, which has no digest", () => {
    const error = new Error("client boom");
    render(<RouteError error={error} retry={() => {}} />);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("retries", async () => {
    const retry = vi.fn();
    render(<RouteError error={new Error("x")} retry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
