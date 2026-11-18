import { describe, it, expect, vi } from "vitest";
import { appConfig } from "@/app.config";
import { STAFF_MFA_REQUIRED_FROM } from "@/lib/config";
import { blocksStaff, hasVerifiedTotp, isStaffMfaEnforced, staffMfaState } from "@/lib/staff-mfa";
import { readMfaStatus, staffMfaStateFor } from "@/lib/staff-mfa.server";
import { getAalFromAccessToken } from "@/lib/supabase/session-claims";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const FROM = "2027-02-01T00:00:00-05:00";
const TOTP = { factor_type: "totp", status: "verified" };

describe("the requirement date (app.config.ts staffMfaRequiredFrom)", () => {
  it("is off in code until the owner sets a date", () => {
    expect(STAFF_MFA_REQUIRED_FROM).toBe(appConfig.staffMfaRequiredFrom);
    expect(appConfig.staffMfaRequiredFrom).toBeNull();
    expect(isStaffMfaEnforced(Date.now())).toBe(false);
  });

  it("is a date that parses whenever it is set (a typo would silently leave staff unprotected)", () => {
    if (appConfig.staffMfaRequiredFrom !== null) expect(Number.isFinite(Date.parse(appConfig.staffMfaRequiredFrom))).toBe(true);
  });

  it("turns on at the instant, on both sides of the boundary", () => {
    const at = Date.parse(FROM);
    expect(isStaffMfaEnforced(at - 1, FROM)).toBe(false);
    expect(isStaffMfaEnforced(at, FROM)).toBe(true);
    expect(isStaffMfaEnforced(at + 86_400_000, FROM)).toBe(true);
  });

  it("counts an empty or unparseable value as off", () => {
    expect(isStaffMfaEnforced(Date.now(), "")).toBe(false);
    expect(isStaffMfaEnforced(Date.now(), "next spring")).toBe(false);
  });
});

describe("hasVerifiedTotp", () => {
  it("counts a verified TOTP only", () => {
    expect(hasVerifiedTotp([TOTP])).toBe(true);
    expect(hasVerifiedTotp([{ factor_type: "totp", status: "unverified" }])).toBe(false);
    expect(hasVerifiedTotp([{ factor_type: "phone", status: "verified" }])).toBe(false);
    expect(hasVerifiedTotp([])).toBe(false);
    expect(hasVerifiedTotp(undefined)).toBe(false);
  });
});

describe("staffMfaState", () => {
  it.each([
    ["aal2", true, false, "ok"],
    ["aal2", true, true, "ok"],
    ["aal1", true, false, "challenge"],
    ["aal1", true, true, "challenge"],
    [null, true, false, "challenge"],
    ["aal1", false, false, "suggest"],
    ["aal1", false, true, "enrol"],
  ] as const)("aal %s, factor %s, required %s -> %s", (aal, hasFactor, enforced, expected) => {
    expect(staffMfaState({ aal, hasFactor, enforced })).toBe(expected);
  });

  it("blocks a challenge and an enrolment, and lets ok and suggest through", () => {
    expect(["ok", "suggest", "challenge", "enrol"].map((s) => blocksStaff(s as never))).toEqual([false, false, true, true]);
  });
});

describe("readMfaStatus and staffMfaStateFor", () => {
  function client({ aal, factors, userError = false }: { aal?: string; factors?: unknown[]; userError?: boolean }) {
    return {
      auth: {
        getClaims: vi.fn(async () => ({ data: { claims: { aal } }, error: null })),
        getUser: vi.fn(async () => (userError ? { data: { user: null }, error: new Error("down") } : { data: { user: { factors } }, error: null })),
      },
    };
  }

  it("takes aal2 from the token without asking Supabase Auth about the user", async () => {
    const supabase = client({ aal: "aal2" });
    await expect(readMfaStatus(supabase as never)).resolves.toEqual({ aal2: true, hasFactor: true });
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it("reads the factors fresh at aal1, so a factor removed in the dashboard counts at once", async () => {
    await expect(readMfaStatus(client({ aal: "aal1", factors: [TOTP] }) as never)).resolves.toEqual({ aal2: false, hasFactor: true });
    await expect(readMfaStatus(client({ aal: "aal1", factors: [] }) as never)).resolves.toEqual({ aal2: false, hasFactor: false });
  });

  it("treats a failed read as having a factor, so the visitor gets the code screen rather than the admin area", async () => {
    await expect(readMfaStatus(client({ aal: "aal1", userError: true }) as never)).resolves.toEqual({ aal2: false, hasFactor: true });
  });

  it("gives the state for each case, with the requirement off", async () => {
    await expect(staffMfaStateFor(client({ aal: "aal2" }) as never)).resolves.toBe("ok");
    await expect(staffMfaStateFor(client({ aal: "aal1", factors: [TOTP] }) as never)).resolves.toBe("challenge");
    await expect(staffMfaStateFor(client({ aal: "aal1", factors: [] }) as never)).resolves.toBe("suggest");
  });
});

describe("getAalFromAccessToken", () => {
  const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

  it("reads the level, and null when absent, not a string, or the token is malformed", () => {
    expect(getAalFromAccessToken(jwt({ aal: "aal2" }))).toBe("aal2");
    expect(getAalFromAccessToken(jwt({ aal: "aal1" }))).toBe("aal1");
    expect(getAalFromAccessToken(jwt({}))).toBeNull();
    expect(getAalFromAccessToken(jwt({ aal: 2 }))).toBeNull();
    expect(getAalFromAccessToken("garbage")).toBeNull();
  });
});
