import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieJar = new Map<string, string>();
const cookiesMock = vi.fn(async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined) }));
vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }));

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

const insert = vi.fn();
// Whether the member chose "leave me out of statistics" (their profile's analytics_opt_out_at).
let optedOut = false;
const profile = {
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { analytics_opt_out_at: optedOut ? "2026-10-30T10:00:00Z" : null }, error: null }) }) }),
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => (table === "user_profiles" ? profile : { insert: (row: unknown) => insert(table, row) }) }),
}));

import { SESSION_COOKIE } from "@/lib/analytics/session-cookie";
import { SUDO_COOKIE_NAME, signSudoCookie } from "@/lib/sudo-cookie";
import { actionOutcome, recordAction, withAction } from "@/lib/analytics/server";

const SESSION = "33333333-3333-4333-8333-333333333333";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.test" };

beforeEach(() => {
  cookieJar.clear();
  cookiesMock.mockClear();
  getCurrentUser.mockReset().mockResolvedValue(USER);
  optedOut = false;
  insert.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.SUDO_SECRET = "test-sudo-secret";
});

describe("actionOutcome", () => {
  it.each([
    [{ error: "nope" }, false],
    [{ success: false }, false],
    [{ ok: false }, false],
    [{ success: true }, true],
    [{ ok: true }, true],
    [{ id: "p1" }, true],
    [{ error: null }, true],
    [{}, true],
    [undefined, true],
    [null, true],
    ["a string", true],
  ])("%j -> ok %s", (result, ok) => {
    expect(actionOutcome(result)).toEqual({ ok });
  });
});

describe("recordAction", () => {
  it("records the outcome in the visit named by the cookie, as the signed-in user", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    await recordAction("project_created", { ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
    const [table, row] = insert.mock.calls[0];
    expect(table).toBe("analytics_events");
    expect(row).toMatchObject({
      user_id: USER.id,
      session_id: SESSION,
      source: "server",
      event: "action_completed",
      properties: { action: "project_created", ok: true },
      context: {},
      sudo: false,
    });
    expect(row.message_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(row.occurred_at)).not.toBeNaN();
  });

  it("keeps a detail, and records a failure", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    await recordAction("wheel_spun", { ok: true, detail: "nobody" });
    await recordAction("book_added", { ok: false });
    expect(insert.mock.calls.map((c) => c[1].properties)).toEqual([
      { action: "wheel_spun", ok: true, detail: "nobody" },
      { action: "book_added", ok: false },
    ]);
  });

  it("records nothing without the visit's cookie, which only exists while the browser allows tracking", async () => {
    await recordAction("project_created", { ok: true });
    expect(insert).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid", "../../etc", SESSION + "x"])("ignores a cookie that is not a session id: %j", async (value) => {
    cookieJar.set(SESSION_COOKIE, value);
    await recordAction("project_created", { ok: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("records nothing for a member who left usage statistics, even with a visit cookie still alive", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    optedOut = true;
    await recordAction("project_created", { ok: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("records nothing when nobody is signed in", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    getCurrentUser.mockResolvedValue(null);
    await recordAction("project_created", { ok: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("flags an action taken while an admin views as a member", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    cookieJar.set(SUDO_COOKIE_NAME, signSudoCookie(USER.id, "22222222-2222-4222-8222-222222222222"));
    await recordAction("project_created", { ok: true });
    expect(insert.mock.calls[0][1].sudo).toBe(true);
  });

  it("ignores a sudo cookie signed for someone else", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    cookieJar.set(SUDO_COOKIE_NAME, signSudoCookie("99999999-9999-4999-8999-999999999999", "22222222-2222-4222-8222-222222222222"));
    await recordAction("project_created", { ok: true });
    expect(insert.mock.calls[0][1].sudo).toBe(false);
  });

  it("never throws: a database error, a missing request scope, a broken auth lookup", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();

    insert.mockRejectedValue(new Error("down"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();

    cookiesMock.mockRejectedValueOnce(new Error("cookies() was called outside a request scope"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();

    getCurrentUser.mockRejectedValueOnce(new Error("auth down"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();
  });

  it("drops a detail that is too long for the plan rather than storing it", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    await recordAction("wheel_spun", { ok: true, detail: "x".repeat(50) });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("withAction", () => {
  beforeEach(() => cookieJar.set(SESSION_COOKIE, SESSION));

  it("returns the action's result unchanged and records success", async () => {
    const result = { success: true, id: "p1" };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(insert.mock.calls[0][1].properties).toEqual({ action: "project_created", ok: true });
  });

  it("records an { error } result as a failure, and still returns it", async () => {
    const result = { error: "Not allowed" };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(insert.mock.calls[0][1].properties).toEqual({ action: "project_created", ok: false });
  });

  it("records a throw as a failure and rethrows the same error", async () => {
    const boom = new Error("boom");
    await expect(withAction("project_created", async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(insert.mock.calls[0][1].properties).toEqual({ action: "project_created", ok: false });
  });

  it("counts a thrown redirect as success, since that is how an action finishes", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    await expect(withAction("onboarding_completed", async () => Promise.reject(redirect))).rejects.toBe(redirect);
    expect(insert.mock.calls[0][1].properties).toEqual({ action: "onboarding_completed", ok: true });
  });

  it("lets an action say what success means", async () => {
    await withAction(
      "wheel_spun",
      async () => ({ noOneAvailable: true as const }),
      (r) => ("noOneAvailable" in r ? { ok: true, detail: "nobody" } : actionOutcome(r))
    );
    expect(insert.mock.calls[0][1].properties).toEqual({ action: "wheel_spun", ok: true, detail: "nobody" });
  });

  it("is invisible to the action when recording is impossible", async () => {
    cookieJar.clear();
    const result = { id: 1 };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(insert).not.toHaveBeenCalled();
  });
});
