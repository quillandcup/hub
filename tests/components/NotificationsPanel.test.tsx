// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";

// The actions scope reads/writes to effectiveIdentity.memberId and rely on RLS for owner-only
// writes (supabase/tests/database/notification_preferences.test.sql). These cover the sudo
// refusal, validation, defaults, and the panel saving each switch.

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
// Whether "In the Hub" shows is the member's in_app_notifications flag, read with the service role.
let serviceFake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));

const { getCurrentUser } = await import("@/lib/auth");
const { getEffectiveIdentity } = await import("@/lib/sudo");
const {
  getNotificationSettings,
  listPushDevices,
  removePushDevice,
  removePushSubscription,
  pausePushSubscription,
  resumePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
  setNotificationChannel,
} = await import("@/app/(member)/settings/notificationActions");
const { NotificationsPanel } = await import("@/app/(member)/settings/NotificationsPanel");

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

const upserts = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "upsert"));

beforeEach(() => {
  fake = createFakeSupabase();
  serviceFake = createFakeSupabase();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("getNotificationSettings", () => {
  it("returns the defaults with the member's overrides applied", async () => {
    fake = createFakeSupabase({
      notification_preferences: { data: [{ kind: "prickle_checkout", channel: "slack", enabled: false }] },
    });

    expect(await getNotificationSettings()).toEqual({
      channels: ["slack", "email"],
      webPushPublicKey: null,
      channelsByKind: { prickle_checkin: ["slack", "in_app", "web_push"], prickle_checkout: ["in_app", "web_push"], intro_nudge: ["slack", "in_app"], prickle_nudge: [], big_sister_match: ["slack", "in_app", "web_push"] },
      visibleKinds: ["prickle_checkin", "prickle_checkout", "intro_nudge", "prickle_nudge"],
      readOnly: false,
    });
    const query = fake.queries.find((q) => q.table === "notification_preferences")!;
    expect(query.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("shows Big Sister introductions only to a member with the big_sisters preview", async () => {
    fake = createFakeSupabase({ notification_preferences: { data: [] } });
    serviceFake = createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
    });
    expect((await getNotificationSettings())?.visibleKinds).toContain("big_sister_match");
  });

  it("offers In the Hub only with the member's in_app_notifications flag", async () => {
    serviceFake = createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
    });
    expect((await getNotificationSettings())?.channels).toEqual(["slack", "in_app", "email"]);
  });

  it("offers Browser, and the key devices subscribe with, only with the flag and VAPID keys", async () => {
    serviceFake = createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
    });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    const settings = await getNotificationSettings();
    expect(settings?.channels).toEqual(["slack", "in_app", "web_push", "email"]);
    expect(settings?.webPushPublicKey).toBe("public-key");

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const unconfigured = await getNotificationSettings();
    expect(unconfigured?.channels).toEqual(["slack", "in_app", "email"]);
    expect(unconfigured?.webPushPublicKey).toBeNull();
    vi.unstubAllEnvs();
  });

  it("is read-only in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect((await getNotificationSettings())?.readOnly).toBe(true);
  });
});

describe("push subscriptions", () => {
  const SUBSCRIPTION = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p256", auth: "auth" } };
  const flagged = () =>
    createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
    });
  const written = (method: string) =>
    serviceFake.queries.filter((q) => q.table === "push_subscriptions").flatMap((q) => q.calls).filter((c) => c.method === method);

  it("saves a device for the member, reviving it if it had been removed", async () => {
    serviceFake = flagged();
    expect(await savePushSubscription(SUBSCRIPTION, "Test Browser")).toEqual({ success: true, memberId: "member-1" });
    expect(written("upsert")[0].args).toEqual([
      {
        member_id: "member-1",
        endpoint: SUBSCRIPTION.endpoint,
        p256dh: "p256",
        auth: "auth",
        user_agent: "Test Browser",
        deleted_at: null,
        paused_at: null,
        disabled_at: null,
      },
      { onConflict: "endpoint" },
    ]);
  });

  it("refuses without the flag, in sudo, and for a malformed or non-HTTPS subscription", async () => {
    serviceFake = createFakeSupabase();
    expect(await savePushSubscription(SUBSCRIPTION, null)).toEqual({ error: expect.stringContaining("aren't available") });

    serviceFake = flagged();
    expect(await savePushSubscription({ ...SUBSCRIPTION, endpoint: "http://push.example.test/abc" }, null)).toEqual({
      error: "Invalid push subscription",
    });
    expect(await savePushSubscription({ endpoint: SUBSCRIPTION.endpoint } as never, null)).toEqual({
      error: "Invalid push subscription",
    });

    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await savePushSubscription(SUBSCRIPTION, null)).toEqual({ error: expect.stringContaining("sudo") });
    expect(written("upsert")).toEqual([]);
  });

  it.each([
    "https://127.0.0.1/internal", "https://example.com/push", "https://fcm.googleapis.com.evil.test/push",
    "https://fcm.googleapis.com:8443/push", "https://user:pass@fcm.googleapis.com/push",
  ])("rejects an untrusted endpoint without saving it: %s", async (endpoint) => {
    serviceFake = flagged();
    expect(await savePushSubscription({ ...SUBSCRIPTION, endpoint }, null)).toEqual({ error: "Invalid push subscription" });
    expect(written("upsert")).toEqual([]);
  });

  it("removes only the member's own live subscription for that endpoint", async () => {
    serviceFake = flagged();
    expect(await removePushSubscription(SUBSCRIPTION.endpoint)).toEqual({ success: true });
    const calls = serviceFake.queries.filter((q) => q.table === "push_subscriptions").flatMap((q) => q.calls);
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["endpoint", SUBSCRIPTION.endpoint] });
    expect(calls.find((c) => c.method === "update")!.args[0]).toEqual({ deleted_at: expect.any(String), disabled_at: expect.any(String) });
  });
});

describe("pausing and resuming device consent", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/old";
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "p", auth: "a" } };
  const setup = (response = { data: [{ id: "d1" }] } as object) => {
    serviceFake = createFakeSupabase({
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
      feature_flags: { data: { enabled_globally: true } },
      push_subscriptions: response,
    });
  };
  const writes = () => serviceFake.queries.filter((q) => q.table === "push_subscriptions");

  it("pauses the real signed-in member's device, even in sudo, without disabling its consent", async () => {
    setup();
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "someone-else", isSudo: true } as never);
    expect(await pausePushSubscription(endpoint)).toEqual({ success: true, memberId: "member-1" });
    expect(writes()[0].calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["member_id", "member-1"] },
      { method: "eq", args: ["endpoint", endpoint] },
      { method: "is", args: ["disabled_at", null] },
      { method: "update", args: [{ paused_at: expect.any(String) }] },
    ]));
  });
  it("resumes only the current member's existing, still-consented device", async () => {
    setup();
    expect(await resumePushSubscription(endpoint, subscription)).toEqual({ success: true });
    expect(writes()[0].calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["member_id", "member-1"] },
      { method: "eq", args: ["endpoint", endpoint] },
      { method: "is", args: ["disabled_at", null] },
      { method: "update", args: [{ endpoint: subscription.endpoint, p256dh: "p", auth: "a", paused_at: null, deleted_at: null }] },
    ]));
    expect(writes()[0].calls.some((c) => c.method === "upsert")).toBe(false);
  });
  it("requires explicit opt-in when the device was removed or belongs to someone else", async () => {
    setup({ data: [] });
    expect(await resumePushSubscription(endpoint, subscription)).toEqual({ error: "This device needs a new opt-in" });
  });
  it("reports pause and resume database failures", async () => {
    setup({ error: { message: "unavailable" } });
    expect(await pausePushSubscription(endpoint)).toHaveProperty("error");
    expect(await resumePushSubscription(endpoint, subscription)).toHaveProperty("error");
  });
  it("refuses resume in sudo or without the browser feature", async () => {
    setup();
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await resumePushSubscription(endpoint, subscription)).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    serviceFake = createFakeSupabase();
    expect(await resumePushSubscription(endpoint, subscription)).toHaveProperty("error");
    expect(writes()).toHaveLength(0);
  });
  it("refuses malformed endpoints before writing", async () => {
    setup();
    expect(await pausePushSubscription("https://evil.test/")).toHaveProperty("error");
    expect(await resumePushSubscription("https://evil.test/", subscription)).toHaveProperty("error");
    expect(await resumePushSubscription(endpoint, { ...subscription, keys: {} } as never)).toHaveProperty("error");
    expect(writes()).toHaveLength(0);
  });
  it("requires authentication and a member record", async () => {
    setup();
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await pausePushSubscription(endpoint)).toHaveProperty("error");
    expect(await resumePushSubscription(endpoint, subscription)).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    serviceFake = createFakeSupabase();
    expect(await pausePushSubscription(endpoint)).toHaveProperty("error");
    expect(await resumePushSubscription(endpoint, subscription)).toHaveProperty("error");
  });
  it("marks paused devices in the list so they can still be removed remotely", async () => {
    serviceFake = createFakeSupabase({ push_subscriptions: { data: [{ id: "d1", endpoint, paused_at: "2026-10-18T00:00:00Z" }] } });
    expect(await listPushDevices(endpoint)).toEqual([expect.objectContaining({ id: "d1", paused: true, isThisDevice: true })]);
  });
});

describe("setNotificationChannel", () => {
  it("upserts the member's choice", async () => {
    expect(await setNotificationChannel("prickle_checkin", "slack", false)).toEqual({ success: true });
    expect(upserts()[0].calls.find((c) => c.method === "upsert")!.args).toEqual([
      { member_id: "member-1", kind: "prickle_checkin", channel: "slack", enabled: false },
      { onConflict: "member_id,kind,channel" },
    ]);
  });

  it("refuses in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await setNotificationChannel("prickle_checkin", "slack", false)).toHaveProperty("error");
    expect(upserts()).toHaveLength(0);
  });

  it("rejects unknown kinds and channels", async () => {
    expect(await setNotificationChannel("spam", "slack", true)).toEqual({ error: "Invalid notification setting" });
    expect(await setNotificationChannel("prickle_checkin", "fax", true)).toEqual({ error: "Invalid notification setting" });
    expect(upserts()).toHaveLength(0);
  });
});

describe("push devices", () => {
  const ROWS = [
    { id: "d1", member_id: "member-1", endpoint: "https://fcm.googleapis.com/fcm/send/1", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) CriOS/126.0 Mobile Safari/604.1", created_at: "2026-10-01T00:00:00Z", last_sent_at: null },
    { id: "d2", member_id: "member-1", endpoint: "https://fcm.googleapis.com/fcm/send/2", user_agent: null, created_at: "2026-09-01T00:00:00Z", last_sent_at: "2026-10-02T00:00:00Z" },
  ];
  const flagged = (extra = {}) =>
    createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "member-1", user_id: "user-1" }] },
      ...extra,
    });

  it("lists the member's devices with a label, marking the asking browser by its endpoint", async () => {
    serviceFake = createFakeSupabase({ push_subscriptions: { data: ROWS } });
    const devices = await listPushDevices("https://fcm.googleapis.com/fcm/send/2");
    expect(devices).toEqual([
      { id: "d1", label: "Chrome on iPhone", addedAt: "2026-10-01T00:00:00Z", lastSentAt: null, isThisDevice: false },
      { id: "d2", label: "Unknown device", addedAt: "2026-09-01T00:00:00Z", lastSentAt: "2026-10-02T00:00:00Z", isThisDevice: true },
    ]);
    const calls = serviceFake.queries.find((q) => q.table === "push_subscriptions")!.calls;
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("reports a device lookup failure instead of treating the current browser as unowned", async () => {
    serviceFake = createFakeSupabase({ push_subscriptions: { error: { message: "database unavailable" } } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(listPushDevices("https://fcm.googleapis.com/fcm/send/token"))
      .rejects.toThrow("Couldn't load browser notification devices");
    error.mockRestore();
  });

  it("removes only the member's own device by id, and refuses in sudo", async () => {
    serviceFake = flagged();
    expect(await removePushDevice("d1")).toEqual({ success: true });
    const calls = serviceFake.queries.filter((q) => q.table === "push_subscriptions").flatMap((q) => q.calls);
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["id", "d1"] });

    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await removePushDevice("d1")).toEqual({ error: expect.stringContaining("sudo") });
  });

  it("refuses a test when no device is subscribed, and in sudo", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    serviceFake = flagged({ push_subscriptions: { data: [] } });
    expect(await sendTestPushNotification()).toEqual({ error: expect.stringContaining("No device") });

    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await sendTestPushNotification()).toEqual({ error: expect.stringContaining("sudo") });
    vi.unstubAllEnvs();
  });
});

describe("NotificationsPanel", () => {
  const initial = {
    channels: ["slack" as const],
    webPushPublicKey: null,
    channelsByKind: { prickle_checkin: ["slack" as const], prickle_checkout: [], intro_nudge: [], prickle_nudge: [], big_sister_match: [] },
    visibleKinds: ["prickle_checkin" as const, "prickle_checkout" as const, "intro_nudge" as const, "prickle_nudge" as const],
    readOnly: false,
  };

  it("leaves out a kind the member can't see", () => {
    render(<NotificationsPanel initial={initial} />);
    expect(screen.queryByText("Big Sister introductions")).toBeNull();
    cleanup();
    render(<NotificationsPanel initial={{ ...initial, visibleKinds: [...initial.visibleKinds, "big_sister_match" as const] }} />);
    expect(screen.getByText("Big Sister introductions")).toBeInTheDocument();
  });

  it("shows each kind as a pressed or unpressed channel logo's channels and saves a switch", async () => {
    render(<NotificationsPanel initial={initial} />);
    const checkin = screen.getByRole("button", { name: "Prickle check-ins via Slack" });
    const checkout = screen.getByRole("button", { name: "Prickle check-outs via Slack" });
    expect(checkin).toHaveAttribute("aria-pressed", "true");
    expect(checkout).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(checkin);

    await waitFor(() => expect(upserts()).toHaveLength(1));
    expect(checkin).toHaveAttribute("aria-pressed", "false");
  });

  it("reverts a switch whose save failed and says so", async () => {
    fake = createFakeSupabase({ notification_preferences: { error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NotificationsPanel initial={initial} />);
    const checkin = screen.getByRole("button", { name: "Prickle check-ins via Slack" });

    await userEvent.click(checkin);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(checkin).toHaveAttribute("aria-pressed", "true");
  });

  it("shows In the Hub only when it's one of the member's channels", () => {
    const { unmount } = render(<NotificationsPanel initial={initial} />);
    expect(screen.queryByRole("button", { name: "Prickle check-ins via In the Hub" })).not.toBeInTheDocument();
    unmount();

    render(
      <NotificationsPanel
        initial={{ ...initial, channels: ["slack", "in_app"], channelsByKind: { prickle_checkin: ["in_app"], prickle_checkout: [], intro_nudge: [], prickle_nudge: [], big_sister_match: [] } }}
      />
    );
    expect(screen.getByRole("button", { name: "Prickle check-ins via In the Hub" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Prickle check-ins via Slack" })).toHaveAttribute("aria-pressed", "false");
  });

  it("lets a member opt in to email for a kind and saves it", async () => {
    render(<NotificationsPanel initial={{ ...initial, channels: ["slack", "email"] }} />);
    const email = screen.getByRole("button", { name: "Prickle check-ins via Email" });
    expect(email).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(email);

    await waitFor(() => expect(upserts()).toHaveLength(1));
    expect(email).toHaveAttribute("aria-pressed", "true");
    const upsert = upserts()[0].calls.find((c) => c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ kind: "prickle_checkin", channel: "email", enabled: true });
  });

  it("disables every switch when read-only", () => {
    render(<NotificationsPanel initial={{ ...initial, readOnly: true }} />);
    for (const box of screen.getAllByRole("button")) expect(box).toBeDisabled();
    expect(screen.getByText(/sudo mode/)).toBeInTheDocument();
  });
});
