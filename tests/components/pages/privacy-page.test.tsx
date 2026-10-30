// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import type { FeatureKey } from "@/lib/features";
import { RETENTION } from "@/lib/retention";
import { SUPPORT_EMAIL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));

const getUserFeaturePreviews = vi.fn<(userId: string) => Promise<FeatureKey[]>>();
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => getUserFeaturePreviews(id) }));

const isAnalyticsOptedOut = vi.fn<(userId: string) => Promise<boolean>>();
vi.mock("@/lib/analytics/opt-out", () => ({ isAnalyticsOptedOut: (id: string) => isAnalyticsOptedOut(id) }));

vi.mock("@/app/(member)/privacy/actions", () => ({ setAnalyticsOptOut: vi.fn() }));

import PrivacyPage, { PRIVACY_REVIEWED } from "@/app/(member)/privacy/page";

/** The section with this id, as a Testing Library scope. */
function section(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no section #${id}`);
  return within(el);
}

describe("/privacy (message_privacy flag)", () => {
  beforeEach(() => {
    resetServerPageMocks();
    getUserFeaturePreviews.mockReset();
    isAnalyticsOptedOut.mockReset();
    isAnalyticsOptedOut.mockResolvedValue(false);
  });

  it("redirects anonymous visitors to /login", async () => {
    signInAs(null);
    await expectRedirect(PrivacyPage, {}, "/login");
  });

  it("redirects members without the flag to /dashboard", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue([]);
    await expectRedirect(PrivacyPage, {}, "/dashboard");
  });
});

describe("/privacy page", () => {
  beforeEach(async () => {
    resetServerPageMocks();
    getUserFeaturePreviews.mockReset();
    isAnalyticsOptedOut.mockReset();
    isAnalyticsOptedOut.mockResolvedValue(false);
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
  });

  it("opens with a short summary, a review date and links to each part", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The short version" })).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", PRIVACY_REVIEWED);
    expect(PRIVACY_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const nav = within(screen.getByRole("navigation", { name: "On this page" }));
    for (const [label, id] of [
      ["What we collect", "collect"],
      ["Who can see it", "who-sees"],
      ["Chat and messages", "chat"],
      ["How long we keep things", "keep"],
      ["Your choices", "choices"],
      ["Services we use", "services"],
    ] as const) {
      expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("puts the retention numbers in the summary and the table from the one place the job reads them", async () => {
    await renderServerPage(PrivacyPage, {});
    const summary = within(screen.getByRole("heading", { name: "The short version" }).closest("aside")!);
    expect(summary.getByText(new RegExp(`${RETENTION.rawNetworkDays} days`))).toBeInTheDocument();
    expect(summary.getByText(new RegExp(`${RETENTION.usageMonths} months`))).toBeInTheDocument();
    const keep = section("keep");
    expect(keep.getByText(new RegExp(`${RETENTION.usageMonths} months, then only anonymous totals`))).toBeInTheDocument();
    expect(keep.getByText(new RegExp(`${RETENTION.rawNetworkDays} days\\. After that we keep the approximate place`))).toBeInTheDocument();
    expect(keep.getByText(/Until you ask us to remove it\. If you leave and come back years later/)).toBeInTheDocument();
    // Course viewing is kept like the rest of what you do in the Hub, so it has no row of its own.
    expect(keep.getByText(/What you do in the Hub: .*course viewing, chat messages and activity/)).toBeInTheDocument();
    expect(keep.queryByText(/As described under Chat and messages/)).not.toBeInTheDocument();
  });

  it("says what is collected, including that search never records the words typed", async () => {
    await renderServerPage(PrivacyPage, {});
    const collect = section("collect");
    expect(collect.getByText(/what kind of search you ran and how many results \(never the words\)/)).toBeInTheDocument();
    expect(collect.getByText(/we record where you stopped|Where you stopped, which parts you watched/i)).toBeInTheDocument();
    expect(collect.getByText(/The IP address your connection comes from/)).toBeInTheDocument();
    expect(section("choices").getByText(/It does not record what you\s+type into search, forms or messages/)).toBeInTheDocument();
  });

  it("says who can see what, without claiming members see their own usage log", async () => {
    await renderServerPage(PrivacyPage, {});
    const who = section("who-sees");
    expect(who.getByText(/Not your usage statistics, your IP address or your private notes/)).toBeInTheDocument();
    expect(who.getByText(/individual records are tied to your account while they are kept/)).toBeInTheDocument();
    expect(who.queryByText(/Everything above that is about you/)).not.toBeInTheDocument();
  });

  it("keeps the chat explanations: what staff see, break-glass, Slack connection, view-as, deleted messages", async () => {
    await renderServerPage(PrivacyPage, {});
    const chat = section("chat");
    expect(chat.getByRole("heading", { name: "What staff can see" })).toBeInTheDocument();
    expect(chat.getByText(/^Group DMs that include Billie Bot/)).toBeInTheDocument();
    // What the page says about the chat has to be true of the app: no per-channel "staff can read this" note, and deleted messages don't count.
    expect(chat.queryByText(/Each channel in the Hub shows/)).not.toBeInTheDocument();
    expect(chat.getByText(/no longer count toward your activity/)).toBeInTheDocument();
    // Deleted content is readable by nobody through the app (RLS needs deleted_at IS NULL), so the page must not say staff can read it.
    expect(chat.getByText(/can't read a deleted message's text or files in the Hub/)).toBeInTheDocument();
    expect(chat.queryByText(/only where they could see the original/)).not.toBeInTheDocument();
    expect(chat.getByText(/we will record who looked, why and when/)).toBeInTheDocument();
    expect(chat.getByText("Break-glass access")).toBeInTheDocument();
    expect(chat.getByText(/It doesn't give the Hub access to your one-on-one Slack direct messages/)).toBeInTheDocument();
    expect(chat.getByText("Viewing the Hub as you")).toBeInTheDocument();
    expect(chat.getByText(/when you last read it/)).toBeInTheDocument();
  });

  it("folds the long chat explanations into collapsed details", async () => {
    await renderServerPage(PrivacyPage, {});
    const titles = [...document.querySelectorAll("details > summary")].map((s) => s.textContent);
    expect(titles).toEqual(["Break-glass access", "Connecting your Slack account", "Viewing the Hub as you", "Deleted messages and reactions"]);
    expect(document.querySelectorAll("details[open]")).toHaveLength(0);
  });

  it("states the consent rule and that the switch leaves a member out", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    expect(choices.getByText(/we ask before we start, with the banner/)).toBeInTheDocument();
    expect(choices.getByText(/if you decline we don't record any of this/)).toBeInTheDocument();
    expect(choices.getByRole("switch", { name: "Leave me out of usage statistics" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows the switch on when the member has left usage statistics, and read-only in sudo", async () => {
    isAnalyticsOptedOut.mockResolvedValue(true);
    await renderServerPage(PrivacyPage, {});
    expect(section("choices").getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(isAnalyticsOptedOut).toHaveBeenCalledWith(MEMBER_USER.id);
  });

  it("can't be changed while an admin views as a member", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await renderServerPage(PrivacyPage, {});
    expect(section("choices").getByRole("switch")).toBeDisabled();
    expect(section("choices").getByText(/can't be changed while viewing as a member/)).toBeInTheDocument();
  });

  it("lists the cookies, including the visit number and when it expires", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    expect(choices.getByRole("heading", { name: "Cookies" })).toBeInTheDocument();
    expect(choices.getByText(/visit number/, { selector: "strong" })).toBeInTheDocument();
    expect(choices.getByText(/it expires\s+after 30 minutes without activity/)).toBeInTheDocument();
  });

  it("says notifications can go to several places without listing them all, and what is recorded about them", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    expect(choices.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    // "such as", so the page doesn't need an edit when a channel is added.
    expect(choices.getByText(/in more than one place, such as Slack, email, inside the Hub, or your browser/)).toBeInTheDocument();
    expect(choices.queryByText(/four places/)).not.toBeInTheDocument();
    expect(choices.getByText(/We keep a record that we sent you each notification/)).toBeInTheDocument();
    // Reading a notification in the Hub is how the bell works; it is not a usage statistic.
    expect(choices.getByText(/whether you have read it, so they know what to show you/)).toBeInTheDocument();
    expect(choices.getByText(/That does not depend\s+on the usage statistics/)).toBeInTheDocument();
    expect(choices.getByText(/takes the tag off the address/)).toBeInTheDocument();
    expect(choices.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/notifications");
  });

  it("states the delete policy once, without listing resources", async () => {
    await renderServerPage(PrivacyPage, {});
    const keep = section("keep");
    expect(keep.getByText("When you delete something")).toBeInTheDocument();
    expect(keep.getByText(/it disappears for you and for everyone else/)).toBeInTheDocument();
    expect(keep.getByText(/We may keep a\s+copy/)).toBeInTheDocument();
    expect(keep.getByText(/we either\s+delete it or take your name off it/)).toBeInTheDocument();
  });

  it("tells members how to ask, with the configured support address, and for what", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    expect(choices.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(choices.getByText(/show you what we hold about you, correct it, remove it, or stop using it for usage/)).toBeInTheDocument();
    expect(choices.getByText(/We will answer as soon as we can, and within a month/)).toBeInTheDocument();
    // Which of the two we do is ours to choose, so the page doesn't offer the member a choice.
    expect(choices.getByText(/For removal we either delete it or take your name off it/)).toBeInTheDocument();
    expect(choices.queryByText(/whichever you/)).not.toBeInTheDocument();
  });

  it("names Google Analytics, describes the other services by kind, and says where error reports are held", async () => {
    await renderServerPage(PrivacyPage, {});
    const services = section("services");
    for (const kind of ["database provider", "sign-in and auth\\s+provider", "hosting provider \\(which also counts visits and page speed\\)", "error-reporting provider", "video hosting provider", "email provider", "Google Analytics", "Slack"]) {
      expect(services.getByText(new RegExp(kind))).toBeInTheDocument();
    }
    expect(services.getByText(/our error-reporting provider \(held in the\s+EU\)/)).toBeInTheDocument();
    // Vercel's own aggregate counts can't be switched off per member, and the page says so next to the switch.
    expect(section("choices").getByText(/that count is not part of the switch below/)).toBeInTheDocument();
    // Everything else stays generic.
    const text = document.body.textContent ?? "";
    for (const vendor of ["Supabase", "Mux", "Sentry", "Resend"]) expect(text).not.toContain(vendor);
  });
});

describe("retention constants", () => {
  it("are what the privacy page and the pruning job both promise", () => {
    expect(RETENTION).toEqual({ rawNetworkDays: 90, usageMonths: 13 });
  });
});
