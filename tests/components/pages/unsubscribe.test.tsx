// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { createFakeSupabase, renderServerPage, type FakeSupabase } from "@/tests/helpers/server-page";
import { signUnsubscribeToken } from "@/lib/email-unsubscribe";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => fake }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: vi.fn(async () => new Map()) }));

const { default: UnsubscribePage } = await import("@/app/unsubscribe/page");
const { setEmailFromToken } = await import("@/app/unsubscribe/actions");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const token = signUnsubscribeToken(MEMBER, "prickle_checkin");
const emailChoice = (enabled: boolean) => ({ member_id: MEMBER, kind: "prickle_checkin", channel: "email", enabled });
const renderFor = (t: string | undefined) => renderServerPage(UnsubscribePage, { searchParams: Promise.resolve({ t }) });
const upserts = () => fake.queries.flatMap((q) => q.calls.filter((c) => c.method === "upsert"));
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  fake = createFakeSupabase();
  revalidatePath.mockClear();
});

describe("/unsubscribe page", () => {
  it("offers to unsubscribe a member who gets the emails, without changing anything by being viewed", async () => {
    fake = createFakeSupabase({ notification_preferences: { data: [emailChoice(true)] } });
    await renderFor(token);

    expect(screen.getByRole("heading")).toHaveTextContent("prickle check-ins");
    expect(screen.getByRole("button", { name: /Unsubscribe from these emails/ })).toBeInTheDocument();
    expect(document.querySelector('input[name="enabled"]')).toHaveValue("false");
    expect(upserts()).toEqual([]);
  });

  it("shows an unsubscribed member the way back", async () => {
    fake = createFakeSupabase({ notification_preferences: { data: [emailChoice(false)] } });
    await renderFor(token);

    expect(screen.getByRole("heading")).toHaveTextContent("You're unsubscribed");
    expect(screen.getByRole("button", { name: "Turn these emails back on" })).toBeInTheDocument();
    expect(document.querySelector('input[name="enabled"]')).toHaveValue("true");
  });

  it("links to the full notification settings", async () => {
    await renderFor(token);

    expect(screen.getByRole("link", { name: /notification settings/ })).toHaveAttribute("href", "/settings/notifications");
  });

  it("says the link doesn't work for a missing or forged token, and offers settings", async () => {
    for (const t of [undefined, `${MEMBER}.prickle_checkin.forged`]) {
      const { unmount } = await renderFor(t);
      expect(screen.getByRole("heading")).toHaveTextContent("doesn't work");
      expect(screen.getByRole("link", { name: /notification settings/ })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("setEmailFromToken", () => {
  it("unsubscribes, and turns it back on, for the token's member and kind", async () => {
    await setEmailFromToken(form({ token, enabled: "false" }));
    await setEmailFromToken(form({ token, enabled: "true" }));

    expect(upserts().map((c) => c.args[0])).toEqual([emailChoice(false), emailChoice(true)]);
    expect(revalidatePath).toHaveBeenCalledWith("/unsubscribe");
  });

  it("does nothing for a forged token", async () => {
    await setEmailFromToken(form({ token: `${MEMBER}.prickle_checkin.forged`, enabled: "false" }));

    expect(upserts()).toEqual([]);
  });
});
