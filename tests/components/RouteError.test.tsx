// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

import RouteError from "@/components/RouteError";
import { SUPPORT_EMAIL } from "@/lib/config";

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
beforeEach(() => vi.stubGlobal("fetch", fetchMock));

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
  vi.unstubAllGlobals();
  captureException.mockReset();
});

describe("RouteError", () => {
  it("shows the digest of a server error and leaves reporting to the server", () => {
    render(<RouteError error={Object.assign(new Error("boom"), { digest: "1203344222" })} retry={() => {}} />);
    expect(screen.getByText("1203344222")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an error raised in the browser, which has no digest", () => {
    const error = new Error("client boom");
    render(<RouteError error={error} retry={() => {}} />);
    expect(captureException).toHaveBeenCalledWith(error);
    expect(fetchMock).toHaveBeenCalledWith("/api/client-errors", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toEqual({ path: window.location.pathname, message: "Error: client boom" });
  });

  it("still shows the page when the report can't be sent", () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<RouteError error={new Error("client boom")} retry={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("retries", async () => {
    const retry = vi.fn();
    render(<RouteError error={new Error("x")} retry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
