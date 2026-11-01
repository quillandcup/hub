import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieJar = new Map<string, string>();
const cookiesMock = vi.fn(async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined) }));
vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }));

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

// The repositories run over an in-memory dataset: the member's profile (whether they chose "leave me out of
// statistics") and the usage events that get stored.
let dataset: InMemoryDataset;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...original, createRepos: () => original.createInMemoryRepos(dataset) };
});

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryAnalyticsEventRepository } from "@/lib/data/analytics-events";
import { SESSION_COOKIE } from "@/lib/analytics/session-cookie";
import { SUDO_COOKIE_NAME, signSudoCookie } from "@/lib/sudo-cookie";
import { actionOutcome, recordAction, withAction } from "@/lib/analytics/server";

const SESSION = "33333333-3333-4333-8333-333333333333";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.test" };

/** The events stored so far. */
const stored = () => dataset.analyticsEvents;

beforeEach(() => {
  cookieJar.clear();
  cookiesMock.mockClear();
  getCurrentUser.mockReset().mockResolvedValue(USER);
  dataset = new InMemoryDataset({ userProfiles: [{ id: USER.id, email: USER.email }] });
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
    expect(stored()).toHaveLength(1);
    const [row] = stored();
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
    expect(stored().map((e) => e.properties)).toEqual([
      { action: "wheel_spun", ok: true, detail: "nobody" },
      { action: "book_added", ok: false },
    ]);
  });

  it("records nothing without the visit's cookie, which only exists while the browser allows tracking", async () => {
    await recordAction("project_created", { ok: true });
    expect(stored()).toEqual([]);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid", "../../etc", SESSION + "x"])("ignores a cookie that is not a session id: %j", async (value) => {
    cookieJar.set(SESSION_COOKIE, value);
    await recordAction("project_created", { ok: true });
    expect(stored()).toEqual([]);
  });

  it("records nothing for a member who left usage statistics, even with a visit cookie still alive", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    dataset.userProfiles[0].analytics_opt_out_at = "2026-10-30T10:00:00Z";
    await recordAction("project_created", { ok: true });
    expect(stored()).toEqual([]);
  });

  it("records nothing when nobody is signed in", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    getCurrentUser.mockResolvedValue(null);
    await recordAction("project_created", { ok: true });
    expect(stored()).toEqual([]);
  });

  it("flags an action taken while an admin views as a member", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    cookieJar.set(SUDO_COOKIE_NAME, signSudoCookie(USER.id, "22222222-2222-4222-8222-222222222222"));
    await recordAction("project_created", { ok: true });
    expect(stored()[0].sudo).toBe(true);
  });

  it("ignores a sudo cookie signed for someone else", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    cookieJar.set(SUDO_COOKIE_NAME, signSudoCookie("99999999-9999-4999-8999-999999999999", "22222222-2222-4222-8222-222222222222"));
    await recordAction("project_created", { ok: true });
    expect(stored()[0].sudo).toBe(false);
  });

  it("never throws: a database error, a missing request scope, a broken auth lookup", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    const record = vi.spyOn(InMemoryAnalyticsEventRepository.prototype, "record").mockRejectedValue(new Error("boom"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("[analytics] Recording an action outcome failed:", "boom");
    record.mockRestore();

    cookiesMock.mockRejectedValueOnce(new Error("cookies() was called outside a request scope"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();

    getCurrentUser.mockRejectedValueOnce(new Error("auth down"));
    await expect(recordAction("project_created", { ok: true })).resolves.toBeUndefined();
  });

  it("drops a detail that is too long for the plan rather than storing it", async () => {
    cookieJar.set(SESSION_COOKIE, SESSION);
    await recordAction("wheel_spun", { ok: true, detail: "x".repeat(50) });
    expect(stored()).toEqual([]);
  });
});

describe("withAction", () => {
  beforeEach(() => cookieJar.set(SESSION_COOKIE, SESSION));

  it("returns the action's result unchanged and records success", async () => {
    const result = { success: true, id: "p1" };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(stored()[0].properties).toEqual({ action: "project_created", ok: true });
  });

  it("records an { error } result as a failure, and still returns it", async () => {
    const result = { error: "Not allowed" };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(stored()[0].properties).toEqual({ action: "project_created", ok: false });
  });

  it("records a throw as a failure and rethrows the same error", async () => {
    const boom = new Error("boom");
    await expect(withAction("project_created", async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(stored()[0].properties).toEqual({ action: "project_created", ok: false });
  });

  it("counts a thrown redirect as success, since that is how an action finishes", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    await expect(withAction("onboarding_completed", async () => Promise.reject(redirect))).rejects.toBe(redirect);
    expect(stored()[0].properties).toEqual({ action: "onboarding_completed", ok: true });
  });

  it("lets an action say what success means", async () => {
    await withAction(
      "wheel_spun",
      async () => ({ noOneAvailable: true as const }),
      (r) => ("noOneAvailable" in r ? { ok: true, detail: "nobody" } : actionOutcome(r))
    );
    expect(stored()[0].properties).toEqual({ action: "wheel_spun", ok: true, detail: "nobody" });
  });

  it("is invisible to the action when recording is impossible", async () => {
    cookieJar.clear();
    const result = { id: 1 };
    await expect(withAction("project_created", async () => result)).resolves.toBe(result);
    expect(stored()).toEqual([]);
  });
});
