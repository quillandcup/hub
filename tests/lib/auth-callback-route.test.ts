import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchange, takeNextPath, logSignIn, rememberSignInMethod, rememberSignInFailure } = vi.hoisted(() => ({
  rememberSignInFailure: vi.fn(),
  rememberSignInMethod: vi.fn(),
  exchange: vi.fn(),
  takeNextPath: vi.fn(),
  logSignIn: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }) }));
vi.mock("@/lib/next-path-cookie", () => ({ takeNextPath }));
vi.mock("@/lib/signin-method", () => ({ rememberSignInMethod, rememberSignInFailure }));
vi.mock("@/lib/signin-log", async () => ({ ...(await vi.importActual<typeof import("@/lib/signin-log")>("@/lib/signin-log")), logSignIn }));

import { GET } from "@/app/auth/callback/route";

const call = (qs: string) => GET(new Request(`https://hub.example.test/auth/callback${qs}`));

beforeEach(() => {
  exchange.mockReset().mockResolvedValue({ error: null });
  takeNextPath.mockReset().mockResolvedValue("/dashboard");
  logSignIn.mockClear();
  rememberSignInMethod.mockClear();
  rememberSignInFailure.mockClear();
});

describe("GET /auth/callback", () => {
  it("signs in and goes to the remembered page, logging nothing", async () => {
    const res = await call("?code=abc");
    expect(res.headers.get("location")).toBe("https://hub.example.test/dashboard");
    expect(logSignIn).not.toHaveBeenCalled();
    expect(rememberSignInMethod).toHaveBeenCalledWith("email_link");
    expect(rememberSignInFailure).not.toHaveBeenCalled();
  });

  it("logs and returns to /login when there is no code", async () => {
    const res = await call("");
    expect(res.headers.get("location")).toBe("https://hub.example.test/login?error=auth_callback_failed");
    expect(logSignIn).toHaveBeenCalledWith("callback_no_code");
    expect(rememberSignInMethod).not.toHaveBeenCalled();
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_no_code");
  });

  it("logs the other-browser case when the PKCE verifier is missing", async () => {
    exchange.mockResolvedValue({ error: { code: "pkce_code_verifier_not_found", status: 400 } });
    const res = await call("?code=abc");
    expect(res.headers.get("location")).toBe("https://hub.example.test/login?error=auth_callback_failed");
    expect(logSignIn).toHaveBeenCalledWith("callback_other_browser", expect.objectContaining({ code: "pkce_code_verifier_not_found" }));
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_other_browser");
  });

  it("logs any other refusal as refused", async () => {
    exchange.mockResolvedValue({ error: { code: "otp_expired", status: 403 } });
    await call("?code=abc");
    expect(logSignIn).toHaveBeenCalledWith("callback_refused", expect.objectContaining({ code: "otp_expired" }));
    expect(rememberSignInFailure).toHaveBeenCalledWith("link_refused");
  });
});
