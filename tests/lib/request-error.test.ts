import { describe, it, expect, vi, beforeEach } from "vitest";

const { setTag, captureRequestError } = vi.hoisted(() => ({ setTag: vi.fn(), captureRequestError: vi.fn(() => "captured") }));
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: typeof setTag }) => unknown) => fn({ setTag }),
  captureRequestError,
}));

import { onRequestError } from "@/lib/request-error";

const request = { path: "/admin/members/x", method: "GET", headers: {} };
const context = { routerKind: "App Router", routePath: "/admin/members/[id]", routeType: "render", renderSource: "react-server-components" } as const;

describe("onRequestError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags the error's digest so it can be searched in Sentry, and still captures it", () => {
    const error = Object.assign(new Error("boom"), { digest: "2853465512" });
    expect(onRequestError(error, request, context)).toBe("captured");
    expect(setTag).toHaveBeenCalledWith("digest", "2853465512");
    expect(captureRequestError).toHaveBeenCalledWith(error, request, context);
  });

  it("captures an error without a digest, untagged", () => {
    onRequestError(new Error("no digest"), request, context);
    expect(setTag).not.toHaveBeenCalled();
    expect(captureRequestError).toHaveBeenCalledTimes(1);
  });
});
