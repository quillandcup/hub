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
import { RETENTION } from "@/lib/retention";
import { SUPPORT_EMAIL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));

const isAnalyticsOptedOut = vi.fn<(userId: string) => Promise<boolean>>();
vi.mock("@/lib/analytics/opt-out", () => ({ isAnalyticsOptedOut: (id: string) => isAnalyticsOptedOut(id) }));

vi.mock("@/app/privacy/actions", () => ({ setAnalyticsOptOut: vi.fn() }));

import PrivacyPage, { PRIVACY_EFFECTIVE } from "@/app/privacy/page";

/** The section with this id, as a Testing Library scope. */
function section(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no section #${id}`);
  return within(el);
}

describe("/privacy access", () => {
  beforeEach(() => {
    resetServerPageMocks();
    isAnalyticsOptedOut.mockReset();
    isAnalyticsOptedOut.mockResolvedValue(false);
  });

  it("is public: an anonymous visitor reads the policy, with a sign-in link instead of the switch", async () => {
    signInAs(null);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to the Hub" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(section("choices").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(isAnalyticsOptedOut).not.toHaveBeenCalled();
  });

  it("gives a signed-in member the switch and a way back to the Hub", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("link", { name: "Back to the Hub" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("is open to every signed-in member, with no feature flag", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
  });
});

describe("/privacy page", () => {
  beforeEach(async () => {
    resetServerPageMocks();
    isAnalyticsOptedOut.mockReset();
    isAnalyticsOptedOut.mockResolvedValue(false);
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
  });

  it("opens with a short summary, an effective date and links to each part", async () => {
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The short version" })).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", PRIVACY_EFFECTIVE);
    expect(PRIVACY_EFFECTIVE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const nav = within(screen.getByRole("navigation", { name: "On this page" }));
    for (const [label, id] of [
      ["What we collect", "collect"],
      ["Who can see it", "who-sees"],
      ["Chat and messages", "chat"],
      ["How long we keep things", "keep"],
      ["Cookies", "cookies"],
      ["Your choices", "choices"],
      ["Services we use", "services"],
      ["Also good to know", "more"],
    ] as const) {
      expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("orders the sections so the one with the actions comes last, and the contents list follows the same order", async () => {
    await renderServerPage(PrivacyPage, {});
    const ids = [...document.querySelectorAll("section[id]")].map((el) => el.id);
    expect(ids).toEqual(["collect", "who-sees", "chat", "keep", "cookies", "services", "more", "choices"]);
    const nav = [...screen.getByRole("navigation", { name: "On this page" }).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(nav).toEqual(ids.map((id) => `#${id}`));
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
    for (const link of collect.getAllByRole("link", { name: "see below" })) expect(link).toHaveAttribute("href", "#choices");
    expect(collect.getByText(/we record where you stopped|Where you stopped, which parts you watched/i)).toBeInTheDocument();
    expect(collect.getByText(/The IP address your connection comes from/)).toBeInTheDocument();
    // The pointer to the chat section sits in the Chat row itself.
    const chatRow = collect.getByText("Chat", { selector: "td" }).closest("tr")!;
    expect(within(chatRow).getByText(/Chat is covered in/)).toBeInTheDocument();
    expect(within(chatRow).getByRole("link", { name: "its own section" })).toHaveAttribute("href", "#chat");
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
    expect(titles).toEqual(["Break-glass access", "Connecting your Slack account", "Viewing the Hub as you", "Deleted messages and reactions", "How usage statistics work"]);
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

  it("describes the cookies by kind in a short list rather than listing every one, and says which are optional", async () => {
    await renderServerPage(PrivacyPage, {});
    const cookies = section("cookies");
    expect(cookies.getByRole("heading", { name: "Cookies and similar storage" })).toBeInTheDocument();
    expect(cookies.getByText(/so we don't need your consent for it, and you\s+can clear it in your browser settings/)).toBeInTheDocument();
    const list = within(cookies.getByText("To make the Hub work:").closest("ul")!);
    expect(list.getAllByRole("listitem")).toHaveLength(4);
    expect(list.getByText(/your last chat channel,\s+your video speed and captions, and your recent searches/)).toBeInTheDocument();
    expect(list.getByText("Visit number", { selector: "strong" })).toBeInTheDocument();
    expect(list.getByText(/expires after 30 minutes without activity and holds nothing about you/)).toBeInTheDocument();
    expect(list.getByText(/sets its own cookie, only if you have allowed it/)).toBeInTheDocument();
  });

  it("puts the switch first, with how usage statistics work folded away below it", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    const toggle = choices.getByRole("switch", { name: "Leave me out of usage statistics" });
    const folded = choices.getByText("How usage statistics work").closest("details")!;
    expect(folded).not.toHaveAttribute("open");
    // The switch comes before the folded explanation in the page.
    expect(toggle.compareDocumentPosition(folded) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(folded).getByText(/our host, Vercel,\s+also counts visits and page speed in aggregate/i)).toBeInTheDocument();
    expect(within(folded).getByText(/that count is not part of\s+this switch/)).toBeInTheDocument();
  });

  it("says what is kept about notifications under What we collect, and that turning statistics off doesn't change read marks", async () => {
    await renderServerPage(PrivacyPage, {});
    const row = within(section("collect").getByText("Notifications", { selector: "td" }).closest("tr")!);
    expect(row.getByText(/A record of each notification we send you, and whether you have read it in the Hub/)).toBeInTheDocument();
    // Reading a notification in the Hub is how the bell works; it is not a usage statistic.
    expect(row.getByText(/Turning usage statistics off does not change that/)).toBeInTheDocument();
    expect(row.getByText(/If usage statistics are on, also which notification a visit came from/)).toBeInTheDocument();
    expect(row.queryByText(/takes the tag off the address/)).not.toBeInTheDocument();
  });

  it("leaves only the choice under Your choices: several places, set per kind in Settings, without listing them all", async () => {
    await renderServerPage(PrivacyPage, {});
    const choices = section("choices");
    expect(choices.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    // "such as", so the page doesn't need an edit when a channel is added.
    expect(choices.getByText(/in more than one place, such as Slack, email, inside the Hub, or your browser/)).toBeInTheDocument();
    expect(choices.queryByText(/four places/)).not.toBeInTheDocument();
    expect(choices.queryByText(/We keep a record/)).not.toBeInTheDocument();
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

  it("lists each class of service, generic infrastructure first and named services after", async () => {
    await renderServerPage(PrivacyPage, {});
    const services = section("services");
    for (const kind of [
      "database provider, our sign-in and auth provider, and our hosting provider \\(which also counts visits and page speed\\)",
      "payment and course providers \\(Stripe and Kajabi\\)",
      "Zoom, where live prickles happen",
      "Slack, for chat and notifications",
      "email provider, and your browser's push service",
      "video hosting provider, for course videos",
      "Google Calendar for the prickle schedule, and Google Photos only when you choose",
      "Gravatar, which supplies a profile picture",
      "monitoring providers, for errors and performance",
      "Google Analytics, only where you allow it",
    ]) {
      expect(services.getByText(new RegExp(kind))).toBeInTheDocument();
    }
    const order = [...services.getAllByRole("listitem")].map((li) => li.textContent ?? "");
    expect(order.findIndex((t) => t.includes("video hosting provider"))).toBeLessThan(order.findIndex((t) => t.startsWith("Zoom")));
    expect(order.findIndex((t) => t.startsWith("Zoom"))).toBeLessThan(order.findIndex((t) => t.startsWith("Slack")));
    expect(services.getByText(/scrambled form of your email address/)).toBeInTheDocument();
    expect(services.getByText(/Our database and hosting are in the United States, so if you use the Hub from elsewhere your information is transferred\s+there/)).toBeInTheDocument();
    expect(services.getByText(/certified under the EU-U\.S\. Data Privacy Framework \(and its UK extension\) or we rely on standard\s+contractual clauses with them/)).toBeInTheDocument();
    // Vercel's own aggregate counts can't be switched off per member, and the page says so next to the switch.
    expect(section("choices").getByText(/that count is not part of\s+this switch/)).toBeInTheDocument();
    // The infrastructure vendors stay generic.
    const text = document.body.textContent ?? "";
    for (const vendor of ["Supabase", "Mux", "Sentry", "Resend"]) expect(text).not.toContain(vendor);
  });
});

describe("/privacy policy sections", () => {
  beforeEach(async () => {
    resetServerPageMocks();
    isAnalyticsOptedOut.mockReset();
    isAnalyticsOptedOut.mockResolvedValue(false);
    signInAs(null);
    await renderServerPage(PrivacyPage, {});
  });

  it("keeps the short notes from the former policy: sharing, security, children, other sites, changes", () => {
    const more = section("more");
    expect(more.getByText(/We don't share your information/)).toBeInTheDocument();
    expect(more.getByText(/we take it seriously: connections are encrypted and staff access is limited by role/)).toBeInTheDocument();
    expect(more.getByText(/the Hub isn't for children under 13/)).toBeInTheDocument();
    expect(more.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(more.getByText(/have their own privacy practices/)).toBeInTheDocument();
    expect(more.getByText(/we update the effective date above, and changes apply immediately/)).toBeInTheDocument();
  });

  it("says error recordings are kept even when usage statistics are off, and that ordinary recordings follow the switch", () => {
    const row = within(section("collect").getByText("Errors and performance", { selector: "td" }).closest("tr")!);
    expect(row.getByText(/a short recording of what was on screen around it, with text and form fields masked/)).toBeInTheDocument();
    expect(row.getByText(/This is not part of usage statistics/)).toBeInTheDocument();
    const choices = section("choices");
    expect(choices.getByText(/we also record a small share of visits as screen recordings, with text and form fields masked/)).toBeInTheDocument();
    expect(choices.getByText(/they continue if you leave statistics off/)).toBeInTheDocument();
    expect(choices.getByText(/apart from the error recordings described below/)).toBeInTheDocument();
  });

  it("says who can see error recordings and how long recordings are kept", () => {
    const who = within(section("who-sees").getByText("Our product and engineering team", { selector: "td" }).closest("tr")!);
    expect(who.getByText(/the recordings of what was on screen around them, in our monitoring tool/)).toBeInTheDocument();
    expect(who.getByText(/Other staff cannot see them/)).toBeInTheDocument();
    const keep = within(section("keep").getByText(/Errors and screen recordings/, { selector: "td" }).closest("tr")!);
    expect(keep.getByText("Up to 90 days, set by our monitoring provider")).toBeInTheDocument();
  });

  it("lists membership, billing and session data", () => {
    expect(section("collect").getByText("Membership, billing and sessions")).toBeInTheDocument();
  });
});

describe("retention constants", () => {
  it("are what the privacy page and the pruning job both promise", () => {
    expect(RETENTION).toEqual({ rawNetworkDays: 90, usageMonths: 13 });
  });
});
