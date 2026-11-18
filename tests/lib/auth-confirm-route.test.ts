import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyOtp, takeNextPath, logSignIn, rememberSignInMethod, rememberSignInFailure } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  takeNextPath: vi.fn(),
  logSignIn: vi.fn(),
  rememberSignInMethod: vi.fn(),
  rememberSignInFailure: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
vi.mock("@/lib/next-path-cookie", () => ({ takeNextPath }));
vi.mock("@/lib/signin-method", () => ({ rememberSignInMethod, rememberSignInFailure }));
vi.mock("@/lib/signin-log", () => ({ logSignIn }));

import { GET, POST } from "@/app/auth/confirm/route";

const ORIGIN = "https://hub.example.test";
const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c";
const NAVIGATION = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

const get = (qs: string, headers: Record<string, string> = NAVIGATION) =>
  GET(new NextRequest(`${ORIGIN}/auth/confirm${qs}`, { headers }));
const post = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields);
  return POST(
    new NextRequest(`${ORIGIN}/auth/confirm`, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
  );
};

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  takeNextPath.mockReset().mockResolvedValue("/remembered");
  logSignIn.mockClear();
  rememberSignInMethod.mockClear();
  rememberSignInFailure.mockClear();
});

describe("GET /auth/confirm, a real browser navigation", () => {
  it("signs in with the token hash and goes to the remembered page, with no extra screen", async () => {
    const res = await get(`?token_hash=${HASH}&type=email`);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "email" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/remembered`);
    expect(rememberSignInMethod).toHaveBeenCalledWith("email_link");
    expect(rememberSignInFailure).not.toHaveBeenCalled();
  });

  it("goes to a same-site next path instead of the remembered one", async () => {
    const res = await get(`?token_hash=${HASH}&type=invite&next=/settings/identity%3Ftab%3Dx`);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "invite" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/settings/identity?tab=x`);
    expect(takeNextPath).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/", "//evil.example", "/\\evil.example", "@evil.example", "/login", "/auth/confirm?x=1", "javascript:alert(1)"])(
    "never redirects to %s",
    async (next) => {
      const res = await get(`?token_hash=${HASH}&type=email&next=${encodeURIComponent(next)}`);
      expect(res.headers.get("location")).toBe(`${ORIGIN}/remembered`);
    }
  );

  it("sends a spent or expired token to the login page and records why, without logging the token", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired", status: 403 } });
    const res = await get(`?token_hash=${HASH}&type=email`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(logSignIn).toHaveBeenCalledWith("confirm_refused", expect.objectContaining({ code: "otp_expired" }));
    expect(JSON.stringify(logSignIn.mock.calls)).not.toContain(HASH);
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_refused");
    expect(rememberSignInMethod).not.toHaveBeenCalled();
  });

  it.each([
    ["no token", ""],
    ["a type we never send", `?token_hash=${HASH}&type=signup`],
    ["a malformed token", "?token_hash=%3Cscript%3E&type=email"],
    ["a missing type", `?token_hash=${HASH}`],
  ])("does not ask Supabase with %s", async (_label, qs) => {
    const res = await get(qs);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(logSignIn).toHaveBeenCalledWith("confirm_no_token", undefined);
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_no_code");
  });

  it("hands an old PKCE link that arrives here on to the callback", async () => {
    const res = await get("?code=abc&next=/x");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/auth/callback?code=abc&next=/x`);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("GET /auth/confirm, a scanner, prefetcher or client without the browser headers", () => {
  it.each([
    ["no Sec-Fetch headers", {}],
    ["a fetch from a script", { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }],
    ["a prefetch", { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "document" }],
    ["an iframe", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }],
  ])("sends %s to the Continue page without spending the token", async (_label, headers) => {
    const res = await get(`?token_hash=${HASH}&type=email&next=/settings`, headers);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(rememberSignInMethod).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/confirm/continue");
    expect(location.searchParams.get("token_hash")).toBe(HASH);
    expect(location.searchParams.get("type")).toBe("email");
    expect(location.searchParams.get("next")).toBe("/settings");
  });

  it("drops an unsafe next on the way to the Continue page", async () => {
    const res = await get(`?token_hash=${HASH}&type=email&next=//evil.example`, {});
    expect(new URL(res.headers.get("location")!).searchParams.has("next")).toBe(false);
  });
});

describe("POST /auth/confirm, the Continue button", () => {
  it("spends the token and signs in, recording the detour", async () => {
    const res = await post({ token_hash: HASH, type: "recovery", next: "/settings" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "recovery" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/settings`);
    expect(rememberSignInMethod).toHaveBeenCalledWith("email_continue");
  });

  it("refuses a spent token the same way as the link", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired", status: 403 } });
    const res = await post({ token_hash: HASH, type: "email" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_refused");
  });

  it("does not follow an open-redirect next", async () => {
    const res = await post({ token_hash: HASH, type: "email", next: "https://evil.example" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/remembered`);
  });

  it("rejects a post with no usable token, or no form at all", async () => {
    expect((await post({ type: "email" })).headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    const res = await POST(
      new NextRequest(`${ORIGIN}/auth/confirm`, { method: "POST", body: "{", headers: { "content-type": "application/json" } })
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
