import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackOutcome, logSignIn } from "@/lib/signin-log";

afterEach(() => vi.restoreAllMocks());

describe("callbackOutcome", () => {
  it("calls a missing PKCE verifier the other-browser case, by code or by error name", () => {
    expect(callbackOutcome({ code: "pkce_code_verifier_not_found" })).toBe("callback_other_browser");
    expect(callbackOutcome({ name: "AuthPKCECodeVerifierMissingError" })).toBe("callback_other_browser");
  });

  it("calls anything else a refused link", () => {
    expect(callbackOutcome({ code: "otp_expired" })).toBe("callback_refused");
    expect(callbackOutcome(null)).toBe("callback_refused");
  });
});

describe("logSignIn", () => {
  it("writes one greppable line with the outcome and Supabase's error code, nothing identifying", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    logSignIn("code_refused", { code: "otp_expired", status: 403, name: "AuthApiError" });

    expect(log).toHaveBeenCalledWith('signin: {"outcome":"code_refused","error_code":"otp_expired","status":403}');
  });

  it("works without an error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logSignIn("code_ok");
    expect(log).toHaveBeenCalledWith('signin: {"outcome":"code_ok"}');
  });
});
