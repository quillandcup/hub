import { beforeEach, describe, expect, it, vi } from "vitest";

const { set, get, cookiesFn } = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), cookiesFn: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => cookiesFn() }));

import { rememberSignInFailure, rememberSignInMethod } from "@/lib/signin-method";
import {
  SIGNIN_FAILURE_COOKIE,
  SIGNIN_METHODS,
  SIGNIN_METHOD_COOKIE,
  isSignInMethod,
  parseSignInFailures,
  readSignInFailures,
  readSignInMethod,
  serializeSignInFailures,
} from "@/lib/signin-method-client";

beforeEach(() => {
  set.mockReset();
  get.mockReset();
  cookiesFn.mockReset().mockResolvedValue({ set, get });
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

describe("rememberSignInFailure", () => {
  it("starts a count for the first failure of a kind", async () => {
    get.mockReturnValue(undefined);
    await rememberSignInFailure("code_refused");
    expect(set).toHaveBeenCalledWith(SIGNIN_FAILURE_COOKIE, "code_refused:1", expect.objectContaining({ path: "/", maxAge: 604800 }));
  });

  it("adds to what is already there, keeping other kinds", async () => {
    get.mockReturnValue({ value: "link_other_browser:1,code_refused:2" });
    await rememberSignInFailure("code_refused");
    expect(set.mock.calls[0][1]).toBe("link_other_browser:1,code_refused:3");
  });

  it("stops counting at 9", async () => {
    get.mockReturnValue({ value: "code_refused:9" });
    await rememberSignInFailure("code_refused");
    expect(set.mock.calls[0][1]).toBe("code_refused:9");
  });

  it("never throws", async () => {
    cookiesFn.mockRejectedValue(new Error("outside a request"));
    await expect(rememberSignInFailure("link_refused")).resolves.toBeUndefined();
  });
});

describe("sign-in failure cookie format", () => {
  it("round-trips, dropping anything that isn't one of our reasons or a sane count", () => {
    expect(parseSignInFailures("link_refused:2,bogus:3,code_refused:0,code_malformed:x,slack_code_refused:50")).toEqual({
      link_refused: 2,
      slack_code_refused: 9,
    });
    expect(serializeSignInFailures({ code_refused: 1, link_other_browser: 2 })).toBe("link_other_browser:2,code_refused:1");
    expect(parseSignInFailures(undefined)).toEqual({});
  });

  it("reads the URL-encoded value from document.cookie, and ignores a broken one", () => {
    expect(readSignInFailures(`a=1; ${SIGNIN_FAILURE_COOKIE}=link_refused%3A2%2Ccode_refused%3A1`)).toEqual({ link_refused: 2, code_refused: 1 });
    expect(readSignInFailures(`${SIGNIN_FAILURE_COOKIE}=%E0%A4%A`)).toEqual({});
    expect(readSignInFailures("a=1")).toEqual({});
  });
});
