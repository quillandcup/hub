// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";

// The actions scope reads/writes to effectiveIdentity.memberId and rely on RLS for owner-only
// writes (supabase/tests/database/notification_preferences.test.sql). These cover the sudo
// refusal, validation, defaults, and the panel saving each switch.

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));

const { getCurrentUser } = await import("@/lib/auth");
const { getEffectiveIdentity } = await import("@/lib/sudo");
const { getNotificationSettings, setNotificationChannel } = await import("@/app/(member)/settings/notificationActions");
const { NotificationsPanel } = await import("@/app/(member)/settings/NotificationsPanel");

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

const upserts = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "upsert"));

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("getNotificationSettings", () => {
  it("returns the defaults with the member's overrides applied", async () => {
    fake = createFakeSupabase({
      notification_preferences: { data: [{ kind: "prickle_checkout", channel: "slack", enabled: false }] },
    });

    expect(await getNotificationSettings()).toEqual({
      channelsByKind: { prickle_checkin: ["slack"], prickle_checkout: [] },
      readOnly: false,
    });
    const query = fake.queries.find((q) => q.table === "notification_preferences")!;
    expect(query.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("is read-only in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect((await getNotificationSettings())?.readOnly).toBe(true);
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

describe("NotificationsPanel", () => {
  const initial = { channelsByKind: { prickle_checkin: ["slack" as const], prickle_checkout: [] }, readOnly: false };

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

  it("disables every switch when read-only", () => {
    render(<NotificationsPanel initial={{ ...initial, readOnly: true }} />);
    for (const box of screen.getAllByRole("button")) expect(box).toBeDisabled();
    expect(screen.getByText(/sudo mode/)).toBeInTheDocument();
  });
});
