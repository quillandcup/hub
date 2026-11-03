import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackOutcome, logSignIn, logSlackLinkOpened } from "@/lib/signin-log";

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

describe("logSlackLinkOpened", () => {
  it("logs the headers that tell a real navigation from a checker, and never the token", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit Mobile",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-site": "cross-site",
      cookie: "secret=1",
    });

    logSlackLinkOpened(headers, true);

    const line = log.mock.calls[0][0] as string;
    expect(line).toBe(
      'signin: {"outcome":"slack_link_opened","navigation":true,"sec_fetch_mode":"navigate","sec_fetch_dest":"document","sec_fetch_site":"cross-site","user_agent":"Mozilla/5.0 (iPhone) AppleWebKit Mobile"}'
    );
    expect(line).not.toContain("secret");
  });

  it("copes with missing headers and cuts a very long user agent", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logSlackLinkOpened(new Headers({ "user-agent": "x".repeat(500) }), false);
    const parsed = JSON.parse((log.mock.calls[0][0] as string).slice("signin: ".length));
    expect(parsed.navigation).toBe(false);
    expect(parsed.user_agent).toHaveLength(300);
    expect(parsed.sec_fetch_mode).toBeUndefined();
  });
});
