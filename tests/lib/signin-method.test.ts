import { beforeEach, describe, expect, it, vi } from "vitest";

const { set, cookiesFn } = vi.hoisted(() => ({ set: vi.fn(), cookiesFn: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => cookiesFn() }));

import { rememberSignInMethod } from "@/lib/signin-method";
import { SIGNIN_METHODS, SIGNIN_METHOD_COOKIE, isSignInMethod, readSignInMethod } from "@/lib/signin-method-client";

beforeEach(() => {
  set.mockReset();
  cookiesFn.mockReset().mockResolvedValue({ set });
});

describe("rememberSignInMethod", () => {
  it("leaves the method in a short-lived cookie the browser can read", async () => {
    await rememberSignInMethod("email_code");
    expect(set).toHaveBeenCalledWith(
      SIGNIN_METHOD_COOKIE,
      "email_code",
      expect.objectContaining({ path: "/", maxAge: 300, sameSite: "lax" })
    );
    expect(set.mock.calls[0][2]).not.toHaveProperty("httpOnly", true);
  });

  it("never throws, so measuring can't block signing in", async () => {
    cookiesFn.mockRejectedValue(new Error("cookies() called outside a request"));
    await expect(rememberSignInMethod("slack_code")).resolves.toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });
});

describe("readSignInMethod", () => {
  it("finds the method among other cookies", () => {
    expect(readSignInMethod(`a=1; ${SIGNIN_METHOD_COOKIE}=slack_link; b=2`)).toBe("slack_link");
  });

  it.each(["", "a=1", `${SIGNIN_METHOD_COOKIE}=bogus`, `${SIGNIN_METHOD_COOKIE}=`])("ignores %j", (cookie) => {
    expect(readSignInMethod(cookie)).toBeNull();
  });

  it("knows every method", () => {
    for (const m of SIGNIN_METHODS) expect(isSignInMethod(m)).toBe(true);
    expect(isSignInMethod("password")).toBe(false);
  });
});
