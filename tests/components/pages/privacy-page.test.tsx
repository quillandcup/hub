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

const getUserFeaturePreviews = vi.fn<(userId: string) => Promise<FeatureKey[]>>();
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => getUserFeaturePreviews(id) }));

import PrivacyPage from "@/app/(member)/privacy/page";

describe("/privacy (message_privacy flag)", () => {
  beforeEach(() => {
    resetServerPageMocks();
    getUserFeaturePreviews.mockReset();
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

  it("renders the content/activity breakdown with the flag on", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Break-glass access" })).toBeInTheDocument();
    expect(screen.getByText(/^Group DMs that include Billie Bot/)).toBeInTheDocument();
    // What the page says about the chat has to be true of the app: no per-channel "staff can read this" note, and deleted messages don't count.
    expect(screen.queryByText(/Each channel in the Hub shows/)).not.toBeInTheDocument();
    expect(screen.getByText(/no longer count toward your activity/)).toBeInTheDocument();
    // Deleted content is readable by nobody through the app (RLS needs deleted_at IS NULL), so the page must not say staff can read it.
    expect(screen.getByText(/can't read a deleted message's text or files in the Hub/)).toBeInTheDocument();
    expect(screen.queryByText(/only where they could see the original/)).not.toBeInTheDocument();
    expect(screen.getByText(/we will record who looked, why and when/)).toBeInTheDocument();
  });

  it("says how course videos are watched and what is recorded about where a visit came from", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "Course videos" })).toBeInTheDocument();
    expect(screen.getByText(/we record where you stopped/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where you connect from" })).toBeInTheDocument();
    expect(screen.getByText(/we record the IP address your connection comes from/)).toBeInTheDocument();
  });
});

describe("/privacy chat sections", () => {
  it("says what connecting Slack allows, that staff can view the Hub as a member, and what staff see in every conversation", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "Connecting your Slack account" })).toBeInTheDocument();
    expect(screen.getByText(/It doesn't give the Hub access to your one-on-one Slack direct messages/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Viewing the Hub as you" })).toBeInTheDocument();
    expect(screen.getByText(/when you last read it/)).toBeInTheDocument();
  });
});

describe("/privacy usage, notifications and retention sections", () => {
  beforeEach(() => {
    resetServerPageMocks();
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
  });

  it("says what the usage log records, and never the words typed", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "How we measure what is useful" })).toBeInTheDocument();
    expect(screen.getByText(/never the words you typed/)).toBeInTheDocument();
    expect(screen.getByText(/It does not record what you type into search, forms or/)).toBeInTheDocument();
  });

  it("states the consent rule and that anyone can ask to be left out", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByText(/we ask before we start, with the banner/)).toBeInTheDocument();
    expect(screen.getByText(/if you decline we don't record any of this/)).toBeInTheDocument();
    expect(screen.getByText(/you can ask us to/)).toBeInTheDocument();
  });

  it("lists the cookies, including the visit number and when it expires", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "Cookies" })).toBeInTheDocument();
    expect(screen.getByText(/visit number/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/it expires after 30 minutes without activity/)).toBeInTheDocument();
  });

  it("names the four notification channels and says what is recorded about them", async () => {
    await renderServerPage(PrivacyPage, {});
    const section = within(screen.getByRole("heading", { name: "Notifications" }).closest("section")!);
    expect(section.getByText(/direct message from Billie Bot in Slack, email/)).toBeInTheDocument();
    expect(section.getByText(/and browser notifications on a device you turn them on for/)).toBeInTheDocument();
    expect(section.getByText(/We keep a record that we sent you each notification/)).toBeInTheDocument();
    expect(section.getByText(/takes the tag off the address/)).toBeInTheDocument();
  });

  it("prints the retention numbers from the one place the job reads them", async () => {
    await renderServerPage(PrivacyPage, {});
    const table = within(screen.getByRole("heading", { name: "How long we keep things" }).closest("section")!);
    expect(table.getByText(new RegExp(`${RETENTION.usageMonths} months, then only anonymous totals`))).toBeInTheDocument();
    expect(table.getByText(new RegExp(`${RETENTION.rawNetworkDays} days\\. After that we keep the approximate place`))).toBeInTheDocument();
    // The IP section repeats the promise, with the same number.
    const where = within(screen.getByRole("heading", { name: "Where you connect from" }).closest("section")!);
    expect(where.getByText(new RegExp(`after ${RETENTION.rawNetworkDays} days`))).toBeInTheDocument();
    // Records of what a member did in the Hub have no automatic limit, and the page says so in the member's terms.
    expect(table.getByText(/Until you ask us to remove it\. If you leave and come back years later/)).toBeInTheDocument();
  });

  it("says deleting a project, goal, entry, book or award removes it but leaves a record, not that it is merely hidden", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "When you delete something else" })).toBeInTheDocument();
    expect(screen.getByText(/it is gone from the Hub for you and for/)).toBeInTheDocument();
    expect(screen.getByText(/Our change history keeps a record that it existed and what it said/)).toBeInTheDocument();
  });

  it("tells members how to ask, with the configured support address, and for what", async () => {
    await renderServerPage(PrivacyPage, {});
    const section = within(screen.getByRole("heading", { name: "Asking us" }).closest("section")!);
    expect(section.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(section.getByText(/show you what we hold about you, correct it, remove it, or stop using it for usage/)).toBeInTheDocument();
    expect(section.getByText(/We will answer within a month/)).toBeInTheDocument();
  });

  it("names the services involved, and the region Sentry is held in", async () => {
    await renderServerPage(PrivacyPage, {});
    const section = within(screen.getByRole("heading", { name: "Services that help us run the Hub" }).closest("section")!);
    for (const service of ["Supabase", "Vercel", "Sentry", "Google Analytics", "Mux", "Slack"]) {
      expect(section.getByText(new RegExp(service))).toBeInTheDocument();
    }
    expect(section.getByText(/Sentry \(error reports, held in the EU\)/)).toBeInTheDocument();
  });
});

describe("retention constants", () => {
  it("are what the privacy page and the pruning job both promise", () => {
    expect(RETENTION).toEqual({ rawNetworkDays: 90, usageMonths: 13 });
  });
});
