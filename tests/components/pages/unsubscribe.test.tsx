// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { signUnsubscribeToken } from "@/lib/email-unsubscribe";

// The page reads and the action writes the member's choice through the notification repository, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: vi.fn(async () => new Map()) }));

const { default: UnsubscribePage } = await import("@/app/unsubscribe/page");
const { setEmailFromToken } = await import("@/app/unsubscribe/actions");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const token = signUnsubscribeToken(MEMBER, "prickle_checkin");
const emailChoice = (enabled: boolean) => ({ memberId: MEMBER, kind: "prickle_checkin", channel: "email", enabled });
const renderFor = (t: string | undefined) => renderServerPage(UnsubscribePage, { searchParams: Promise.resolve({ t }) });
const stored = () => repos.notifications.preferencesOf(MEMBER);
const withChoice = (enabled: boolean) => {
  repos = createInMemoryRepos(new InMemoryDataset({ notificationPreferences: [{ memberId: MEMBER, kind: "prickle_checkin", channel: "email", enabled }] }));
};
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  repos = createInMemoryRepos();
  revalidatePath.mockClear();
});

describe("/unsubscribe page", () => {
  it("offers to unsubscribe a member who gets the emails, without changing anything by being viewed", async () => {
    withChoice(true);
    await renderFor(token);

    expect(screen.getByRole("heading")).toHaveTextContent("prickle check-ins");
    expect(screen.getByRole("button", { name: /Unsubscribe from these emails/ })).toBeInTheDocument();
    expect(document.querySelector('input[name="enabled"]')).toHaveValue("false");
    expect(await stored()).toEqual([emailChoice(true)]);
  });

  it("shows an unsubscribed member the way back", async () => {
    withChoice(false);
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
    expect(await stored()).toEqual([emailChoice(false)]);

    await setEmailFromToken(form({ token, enabled: "true" }));
    expect(await stored()).toEqual([emailChoice(true)]);
    expect(revalidatePath).toHaveBeenCalledWith("/unsubscribe");
  });

  it("does nothing for a forged token", async () => {
    await setEmailFromToken(form({ token: `${MEMBER}.prickle_checkin.forged`, enabled: "false" }));

    expect(await stored()).toEqual([]);
  });
});
