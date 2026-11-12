// @vitest-environment jsdom
/**
 * Hedgie Care (app/(admin)/admin/care): staff only, what needs her reply first on the Active tab, closed and lapsed
 * engagements under Earlier, and the controls that call the server actions. Data comes from the in-memory repository; the actions are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerRoute, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

// The page's own search params are the address bar's, so the owner filter can be read from and written to the URL.
vi.mock("next/navigation", async () => ({
  ...(await import("@/tests/helpers/server-page")).nextNavigationModule,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// The service-role client is only handed to createRepos, which this file replaces.
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const preview = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/staff-preview.server", () => ({ getStaffPreviewRole: async () => preview.role }));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

const actions = vi.hoisted(() => ({
  startEngagement: vi.fn(),
  changeEngagementStart: vi.fn(),
  logCareMessage: vi.fn(),
  updateEngagement: vi.fn(),
  closeEngagement: vi.fn(),
  renewEngagement: vi.fn(),
  reassignEngagement: vi.fn(),
  deleteEngagement: vi.fn(),
  getEngagementResults: vi.fn(),
  searchCareMembers: vi.fn(),
  trackCareDm: vi.fn(),
  untrackCareDm: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/care/actions", () => actions);

import CareIndex from "@/app/(admin)/admin/care/page";
import CareEarlierPage from "@/app/(admin)/admin/care/earlier/page";
import CareDmsPage from "@/app/(admin)/admin/care/dms/page";
import { SLACK_DM_SCOPES } from "@/lib/slack-connect";

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const activePage = () => CareIndex({ searchParams: Promise.resolve({}) } as never);
const earlierPage = () => CareEarlierPage();
const dmsPage = () => CareDmsPage();

const NOW = Date.parse("2026-03-20T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const row = (id: string, member: string, over: Record<string, unknown> = {}) => ({
  id,
  member_id: member,
  opened_by: null,
  owned_by: CM_USER.id,
  reason: "check_in",
  channel: "slack_dm",
  opened_at: ago(10),
  period_ends_on: "2026-04-10",
  renewed_from: null,
  closed_at: null,
  ended_how: null,
  last_staff_message_at: ago(2),
  last_member_message_at: null,
  follow_up_on: null,
  next_step: null,
  notes: null,
  deleted_at: null,
  created_at: ago(10),
  updated_at: ago(10),
  ...over,
});

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const CY = "mbr_AAAAAAAAAAA3";

function seed() {
  dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
      { id: BO, name: "Bo Example", email: "bo@example.test" },
      { id: CY, name: "Cy Example", email: "cy@example.test" },
      { id: "mbr_AAAAAAAAAAA8", name: "Cam Manager", email: "cam@example.test", userId: CM_USER.id },
      { id: "mbr_AAAAAAAAAAA9", name: "Abe Admin", email: "abe@example.test", userId: ADMIN_USER.id },
    ],
    userProfiles: [
      { id: ADMIN_USER.id, email: ADMIN_USER.email!, role: "admin" },
      { id: MEMBER_USER.id, email: MEMBER_USER.email!, role: "member" },
      { id: CM_USER.id, email: CM_USER.email, role: "community_manager" },
    ],
  });
  dataset.careEngagements.push(
    row("care_AAAAAAAAAAA1", BO, { last_staff_message_at: ago(2), owned_by: ADMIN_USER.id }), // waiting on them
    row("care_AAAAAAAAAAA2", ADA, { channel: "email", last_staff_message_at: ago(5), last_member_message_at: ago(1), next_step: "Ask about chapter two", follow_up_on: "2026-03-19", notes: "Mentioned her draft." }), // needs a reply, follow-up overdue
    row("care_AAAAAAAAAAA3", CY, { opened_at: ago(60), last_staff_message_at: ago(40) }), // gone quiet
    row("care_AAAAAAAAAAA4", CY, { channel: "email", closed_at: ago(3), ended_how: "back_in_community" }), // closed lately
    row("care_AAAAAAAAAAA5", BO, { channel: "email", closed_at: ago(90), ended_how: "no_reply" }), // closed long ago
    row("care_AAAAAAAAAAA6", BO, { channel: "prickle", deleted_at: ago(1) }), // removed: not listed
    row("care_AAAAAAAAAAA7", ADA, { period_ends_on: "2026-03-15", last_staff_message_at: ago(8) }), // period over, inside the grace: review due
    row("care_AAAAAAAAAAA8", CY, { owned_by: ADMIN_USER.id, channel: "prickle", period_ends_on: "2026-02-01", opened_at: ago(60), last_staff_message_at: ago(55) }), // lapsed
  );
}

const RESULTS = (() => {
  const window = (name: "before" | "during" | "after", state: "complete" | "so_far" | "not_yet") => ({ name, from: "2026-02-01T05:00:00.000Z", to: "2026-03-01T05:00:00.000Z", state });
  const counts = (n: number) => ({ pricklesAttended: n, slackMessages: n + 1, firstPrickle: n === 2, firstSlackPost: false, peopleConnected: n + 2, programsStarted: n === 2 ? ["Example Program, 6 months"] : [] });
  return {
    windows: {
      before: { window: window("before", "complete"), counts: counts(1) },
      during: { window: window("during", "so_far"), counts: counts(2) },
      after: { window: window("after", "not_yet"), counts: null },
    },
    retention: {
      checkpoints: [
        { days: 60, at: "2026-05-31T04:00:00.000Z", state: "complete", membership: "on_hiatus", programs: ["Example Program, 6 months"] },
        { days: 90, at: "2026-06-30T04:00:00.000Z", state: "complete", membership: "member", programs: [] },
        { days: 180, at: "2026-09-28T04:00:00.000Z", state: "not_yet", membership: null, programs: null },
      ],
      firstLapse: { status: "on_hiatus", at: "2026-04-01T04:00:00.000Z", daysAfterStart: 31 },
    },
  };
})();

// Pinned "now" for the page (lib/clock reads Date) and for the browser's own timing of a close.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetServerPageMocks();
  preview.role = null;
  Object.values(actions).forEach((fn) => fn.mockReset());
  actions.startEngagement.mockResolvedValue({ success: true });
  actions.changeEngagementStart.mockResolvedValue({ success: true });
  actions.logCareMessage.mockResolvedValue({ success: true });
  actions.updateEngagement.mockResolvedValue({ success: true });
  actions.closeEngagement.mockResolvedValue({ success: true });
  actions.renewEngagement.mockResolvedValue({ success: true });
  actions.reassignEngagement.mockResolvedValue({ success: true });
  actions.getEngagementResults.mockResolvedValue({ results: RESULTS });
  actions.deleteEngagement.mockResolvedValue({ success: true });
  actions.searchCareMembers.mockResolvedValue([{ id: BO, name: "Bo Example", detail: "bo@example.test" }]);
  track.mockClear();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

// The owner chips are list items too; a card is the one with a link to the member.
const cards = () => screen.getAllByRole("listitem").filter((li) => li.querySelector("a[href^='/admin/members/']"));

describe("the Active tab", () => {
  it("lists what needs her reply first, then review due, gone quiet and waiting, and nothing that has ended", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(screen.getByRole("heading", { name: "Hedgie Care" })).toBeInTheDocument();
    const names = cards().map((c) => within(c).getAllByRole("link")[0].textContent);
    expect(names).toEqual(["Ada E.", "Ada E.", "Cy Example", "Bo Example"]);
    expect(within(cards()[0]).getByText("Needs your reply")).toBeInTheDocument();
    expect(within(cards()[1]).getByText("Review due")).toBeInTheDocument();
    expect(within(cards()[2]).getByText("Gone quiet")).toBeInTheDocument();
    expect(within(cards()[3]).getByText("Waiting on them")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Active (4)" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the display name first with the legal name beside it, and links to the member", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const ada = cards()[0];
    expect(within(ada).getByRole("link", { name: "Ada E." })).toHaveAttribute("href", `/admin/members/${ADA}`);
    expect(within(ada).getByText("Ada Example")).toBeInTheDocument();
    expect(within(cards()[3]).queryByText("Bo Example", { selector: "span" })).not.toBeInTheDocument();
  });

  it("says where each one stands: who wrote last and how long ago, the period, the follow-up, the next step, the note", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const ada = cards()[0];
    expect(within(ada).getByText(/Last message: they wrote yesterday/)).toBeInTheDocument();
    expect(within(ada).getByText(/Care period ends/)).toBeInTheDocument();
    expect(within(ada).getByText("Follow up due")).toBeInTheDocument();
    expect(within(ada).getByText(/· Follow up \w+/)).toBeInTheDocument();
    expect(within(ada).getByText("Next: Ask about chapter two")).toBeInTheDocument();
    expect(within(ada).getByText("Mentioned her draft.")).toBeInTheDocument();
    expect(within(ada).getByText("A check-in · Email · Period 1")).toBeInTheDocument();
    expect(within(ada).getByText("Owner: Cam Manager")).toBeInTheDocument();
    expect(within(cards()[3]).getByText("Owner: Abe Admin")).toBeInTheDocument();
    expect(within(cards()[3]).getByText(/Last message: you wrote 2 days ago/)).toBeInTheDocument();
    expect(within(cards()[1]).getByText("The care period is over. Renew it if there is a plan, or close it.")).toBeInTheDocument();
    expect(within(cards()[1]).getByText(/Care period ended/)).toBeInTheDocument();
  });

  it("narrows the list by status", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "All (4)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Needs your reply (1)" }));
    expect(cards()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Review due (1)" }));
    expect(within(cards()[0]).getByText("Review due")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gone quiet (1)" }));
    expect(within(cards()[0]).getByText("Gone quiet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All (4)" }));
    expect(cards()).toHaveLength(4);
  });

  it("explains an empty list, and an empty status", async () => {
    dataset.careEngagements.length = 0;
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    expect(screen.getByText("Nothing active. Start a care period above.")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Waiting on them (0)" }));
    expect(screen.queryByText("Nothing here.")).not.toBeInTheDocument();
  });

  it("says nothing here for a status with none", async () => {
    dataset.careEngagements.splice(0, dataset.careEngagements.length, row("care_AAAAAAAAAAA1", BO));
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    await userEvent.setup().click(screen.getByRole("button", { name: "Review due (0)" }));
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("opens for an admin, and for an admin previewing the community manager", async () => {
    signInAs(ADMIN_USER);
    await renderServerRoute(activePage, undefined as never);
    expect(screen.getByRole("heading", { name: "Start a care period" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to /login and a member to /no-access", async () => {
    signInAs(null);
    await expectRedirect(activePage, undefined as never, "/login");
    signInAs(MEMBER_USER);
    await expectRedirect(activePage, undefined as never, "/no-access");
    signInAs(MEMBER_USER);
    await expectRedirect(earlierPage, undefined as never, "/no-access");
  });

  it("redirects an old ?tab=earlier link to the Earlier path", async () => {
    signInAs(CM_USER);
    await expectRedirect(() => CareIndex({ searchParams: Promise.resolve({ tab: "earlier" }) } as never), undefined as never, "/admin/care/earlier");
  });

  describe("without the write feature", () => {
    const granted = [...COMMUNITY_MANAGER_FEATURES];
    beforeEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).splice(0));
    afterEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).push(...granted));

    it("shows the list with no form and no controls", async () => {
      signInAs(CM_USER);
      await renderServerRoute(activePage, undefined as never);
      expect(cards()).toHaveLength(4);
      expect(screen.queryByRole("heading", { name: "Start a care period" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "They replied" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Renew" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Results" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });
  });
});

describe("the Earlier tab", () => {
  it("lists closed and lapsed engagements, the one that ended most recently first, and leaves out removed ones", async () => {
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);

    expect(screen.getByRole("tab", { name: "Earlier (1 lapsed)" })).toHaveAttribute("aria-selected", "true");
    expect(cards()).toHaveLength(3);
    expect(within(cards()[0]).getByText("Closed")).toBeInTheDocument();
    expect(within(cards()[0]).getByText(/Back in the community, closed 3 days ago/)).toBeInTheDocument();
    expect(within(cards()[1]).getByText("Lapsed")).toBeInTheDocument();
    expect(within(cards()[2]).getByText(/No reply, closed 90 days ago/)).toBeInTheDocument();
  });

  it("offers no reply buttons, renewing or closing on one that has ended, but still results and edit", async () => {
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    const closed = cards()[0];
    expect(within(closed).queryByRole("button", { name: "They replied" })).not.toBeInTheDocument();
    expect(within(closed).queryByRole("button", { name: "Renew" })).not.toBeInTheDocument();
    expect(within(closed).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(closed).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(closed).getByRole("button", { name: "Results" })).toBeInTheDocument();
  });

  it("lets her renew a lapsed one: it is still open", async () => {
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    expect(within(cards()[1]).getByRole("button", { name: "Renew" })).toBeInTheDocument();
  });

  it("explains an empty tab", async () => {
    dataset.careEngagements.length = 0;
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    expect(screen.getByText("Nothing has ended yet.")).toBeInTheDocument();
  });

  it("pages a long list", async () => {
    for (let i = 0; i < 25; i++) {
      dataset.careEngagements.push(row(`care_BBBBBBBBB${String(i).padStart(3, "1")}`, BO, { channel: "other", closed_at: ago(100 + i), ended_how: "no_reply" }));
    }
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    expect(cards()).toHaveLength(20);
    expect(screen.getByText(/of 28 care periods/)).toBeInTheDocument();
  });
});

describe("the controls", () => {
  const open = async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    return userEvent.setup();
  };

  it("logs that they replied or that she did, and reports it", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "They replied" }));
    await user.click(within(ada).getByRole("button", { name: "I replied" }));

    expect(actions.logCareMessage).toHaveBeenNthCalledWith(1, "care_AAAAAAAAAAA2", "member");
    expect(actions.logCareMessage).toHaveBeenNthCalledWith(2, "care_AAAAAAAAAAA2", "staff");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_message_logged", { direction: "staff" }));
    expect(track).toHaveBeenCalledWith("care_message_logged", { direction: "member" });
  });

  it("shows an error from the server and does not report it", async () => {
    actions.logCareMessage.mockResolvedValue({ error: "That care period is closed or gone." });
    const user = await open();

    await user.click(within(cards()[0]).getByRole("button", { name: "They replied" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("That care period is closed or gone.");
    expect(track).not.toHaveBeenCalled();
  });

  it("asks why before renewing, shows the results at that moment, then renews with the reason and reports it", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Renew" }));
    expect((await within(ada).findAllByRole("table")).length).toBe(2); // the measured results, loaded for the decision
    expect(actions.getEngagementResults).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    expect(actions.renewEngagement).not.toHaveBeenCalled();

    await user.click(within(ada).getByRole("button", { name: "Renew this care period" }));
    expect(within(ada).getByRole("alert")).toHaveTextContent("Say why you are renewing");
    expect(actions.renewEngagement).not.toHaveBeenCalled();

    await user.type(within(ada).getByLabelText("Why renew? What is the plan?"), "A writing sprint in April");
    await user.click(within(ada).getByRole("button", { name: "Renew this care period" }));

    expect(actions.renewEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2", "A writing sprint in April");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_renewed", { days_open: 10 }));
  });

  it("shows why a renewal was refused and does not report it", async () => {
    actions.renewEngagement.mockResolvedValue({ error: "That care period is already renewed, closed or gone. Refresh the list." });
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Renew" }));
    await user.type(within(ada).getByLabelText("Why renew? What is the plan?"), "A plan");
    await user.click(within(ada).getByRole("button", { name: "Renew this care period" }));

    expect(await within(ada).findByRole("alert")).toHaveTextContent("already renewed");
    expect(track).not.toHaveBeenCalled();
  });

  it("renews one whose period is over, from the Active tab (review due) and from Earlier (lapsed)", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const reviewDue = cards()[1];
    expect(within(reviewDue).getByText("Review due")).toBeInTheDocument();
    await user.click(within(reviewDue).getByRole("button", { name: "Renew" }));
    expect(within(reviewDue).getByLabelText("Why renew? What is the plan?")).toBeInTheDocument();
  });

  it("edits the reason, follow-up, next step and note", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Edit" }));
    await user.selectOptions(within(ada).getByLabelText("Why you are reaching out"), "encouragement");
    const next = within(ada).getByLabelText("Next step");
    await user.clear(next);
    await user.type(next, "Send a note");
    const note = within(ada).getByLabelText("Note");
    await user.clear(note);
    await user.click(within(ada).getByRole("button", { name: "Save" }));

    expect(actions.updateEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2", { reason: "encouragement", notes: "", nextStep: "Send a note", followUpOn: "2026-03-19" });
    await waitFor(() => expect(within(cards()[0]).queryByLabelText("Next step")).not.toBeInTheDocument());
  });

  it("closes with how it ended, each ending explained, the results beside them, and never offers 'renewed'", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Close" }));
    expect((await within(ada).findAllByRole("table")).length).toBe(2);
    await user.click(within(ada).getByRole("button", { name: "Close this care period" }));
    expect(within(ada).getByRole("alert")).toHaveTextContent("Pick how it ended.");
    expect(actions.closeEngagement).not.toHaveBeenCalled();

    const labels = within(ada).getAllByRole("radio").map((r) => r.closest("label")?.textContent ?? "");
    expect(labels).toHaveLength(4);
    expect(labels.join(" ")).not.toContain("Renewed");
    expect(labels[0]).toMatch(/^Handed to someone else.*not yours/);
    expect(labels[1]).toMatch(/^No reply.*never answered/);
    expect(labels[2]).toMatch(/^Back in the community.*took part again/);
    expect(labels[3]).toMatch(/^Ran its course.*later check-in date/);
    expect(within(ada).getByText(/If it is still alive and you have a plan, renew it instead/)).toBeInTheDocument();

    await user.click(within(ada).getByRole("radio", { name: /Back in the community/ }));
    await user.click(within(ada).getByRole("button", { name: "Close this care period" }));

    expect(actions.closeEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2", "back_in_community");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_closed", { ended_how: "back_in_community", days_open: 10 }));
  });

  it("removes an engagement only after she confirms", async () => {
    const user = await open();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await user.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(actions.deleteEngagement).not.toHaveBeenCalled();
    await user.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(actions.deleteEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    confirm.mockRestore();
  });

  it("closes the edit panel when Edit is pressed again", async () => {
    const user = await open();
    const ada = cards()[0];
    await user.click(within(ada).getByRole("button", { name: "Edit" }));
    expect(within(ada).getByLabelText("Next step")).toBeInTheDocument();
    await user.click(within(ada).getByRole("button", { name: "Edit" }));
    expect(within(ada).queryByLabelText("Next step")).not.toBeInTheDocument();
  });
});

describe("the results", () => {
  it("loads on request, shows the windows with membership and programs and the honest limits, and loads once", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0];

    expect(actions.getEngagementResults).not.toHaveBeenCalled();
    await user.click(within(ada).getByRole("button", { name: "Results" }));

    expect(await within(ada).findAllByRole("table")).toHaveLength(2);
    expect(actions.getEngagementResults).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    const [windows, staying] = within(ada).getAllByRole("table");
    const rows = within(windows).getAllByRole("row");
    expect(rows).toHaveLength(4); // header and three windows
    expect(within(rows[1]).getByText("Before")).toBeInTheDocument();
    expect(within(rows[1]).getAllByText("None")).toHaveLength(2); // no firsts in the window, and no programs started
    expect(within(rows[2]).getByText(/so far/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("first prickle")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Example Program, 6 months")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Not yet")).toBeInTheDocument();

    // How they stayed: three distinct states at each checkpoint, "Not yet" for one that has not passed.
    const checkpoints = within(staying).getAllByRole("row");
    expect(checkpoints).toHaveLength(4);
    expect(within(checkpoints[1]).getByText("60 days after the care period")).toBeInTheDocument();
    expect(within(checkpoints[1]).getByText("On hiatus")).toBeInTheDocument();
    expect(within(checkpoints[1]).getByText("Example Program, 6 months")).toBeInTheDocument();
    expect(within(checkpoints[2]).getByText("Active")).toBeInTheDocument();
    expect(within(checkpoints[3]).getByText("Not yet")).toBeInTheDocument();
    expect(within(ada).getByText(/First went on hiatus: 31 days after it started/)).toBeInTheDocument();
    expect(within(ada).getByText(/even if they came back/)).toBeInTheDocument();
    expect(within(ada).getByText(/read each one as a story, not a score/)).toBeInTheDocument();
    expect(within(ada).getByText(/do not show the outreach caused it/)).toBeInTheDocument();

    await user.click(within(ada).getByRole("button", { name: "Results" }));
    expect(within(ada).queryAllByRole("table")).toHaveLength(0);
    await user.click(within(ada).getByRole("button", { name: "Results" }));
    expect(within(ada).getAllByRole("table")).toHaveLength(2);
    expect(actions.getEngagementResults).toHaveBeenCalledTimes(1);
  });

  it("shows the error when they can't be counted", async () => {
    actions.getEngagementResults.mockResolvedValue({ error: "Couldn't work out the results." });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    await userEvent.setup().click(within(cards()[0]).getByRole("button", { name: "Results" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("Couldn't work out the results.");
    expect(within(cards()[0]).queryAllByRole("table")).toHaveLength(0);
  });
});

describe("starting an engagement", () => {
  const open = async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    return userEvent.setup();
  };

  it("explains each reason in a line, so two people pick the same one", async () => {
    await open();
    const radios = screen.getAllByRole("radio", { name: /.+/ }).filter((r) => (r as HTMLInputElement).name === "care-reason");
    expect(radios).toHaveLength(6);
    expect(screen.getByText("You are saying hello to someone you have not spoken with yet.")).toBeInTheDocument();
    expect(screen.getByText("You are asking how their writing is going.")).toBeInTheDocument();
  });

  it("asks for a member first, then a reason", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Start care period" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a member.");
    expect(actions.startEngagement).not.toHaveBeenCalled();
  });

  it("finds a member, starts the engagement with what was filled in, and clears the form", async () => {
    const user = await open();

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.click(screen.getByRole("radio", { name: /A welcome/ }));
    await user.selectOptions(screen.getByLabelText("Where"), "email");
    await user.click(screen.getByLabelText("They wrote to me first"));
    await user.type(screen.getByLabelText("Note"), "Joined last week");
    await user.click(screen.getByRole("button", { name: "Start care period" }));

    expect(actions.startEngagement).toHaveBeenCalledWith({ memberId: BO, startedOn: "2026-03-20", reason: "welcome", channel: "email", memberWroteFirst: true, notes: "Joined last week", followUpOn: "" });
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_started", { reason: "welcome", channel: "email", member_wrote_first: true, backdated: false }));
    await waitFor(() => expect(screen.getByLabelText("Note")).toHaveValue(""));
  });

  it("asks when it started, today by default and never after today, and sends the day she picks", async () => {
    const user = await open();
    const when = screen.getByLabelText("When did this start?");
    expect(when).toHaveValue("2026-03-20"); // the Eastern day of the pinned clock
    expect(when).toHaveAttribute("max", "2026-03-20");

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.click(screen.getByRole("radio", { name: /A welcome/ }));
    fireEvent.change(when, { target: { value: "2026-03-13" } });
    await user.click(screen.getByRole("button", { name: "Start care period" }));

    expect(actions.startEngagement).toHaveBeenCalledWith(expect.objectContaining({ memberId: BO, startedOn: "2026-03-13" }));
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_started", { reason: "welcome", channel: "slack_dm", member_wrote_first: false, backdated: true }));
    // After starting, the day goes back to today for the next one.
    await waitFor(() => expect(screen.getByLabelText("When did this start?")).toHaveValue("2026-03-20"));
  });

  it("will not start without a day", async () => {
    const user = await open();
    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.click(screen.getByRole("radio", { name: /A welcome/ }));
    fireEvent.change(screen.getByLabelText("When did this start?"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Start care period" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Pick the day it started.");
    expect(actions.startEngagement).not.toHaveBeenCalled();
  });

  it("keeps what was typed and says why when the server refuses", async () => {
    actions.startEngagement.mockResolvedValue({ error: "There is already an open care period with them on that channel. Log a message there, or renew it." });
    const user = await open();

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.click(screen.getByRole("radio", { name: /An introduction/ }));
    await user.type(screen.getByLabelText("Note"), "Hi there");
    await user.click(screen.getByRole("button", { name: "Start care period" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already an open care period");
    expect(screen.getByLabelText("Note")).toHaveValue("Hi there");
    expect(track).not.toHaveBeenCalled();
  });
});

describe("what is overdue", () => {
  it("shows the lapsed and review due counts and whose they are, to anyone who opens the page", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByRole("link", { name: "Lapsed: 1" })).toHaveAttribute("href", "/admin/care/earlier");
    expect(within(overdue).getByRole("link", { name: "Review due: 1" })).toHaveAttribute("href", "/admin/care");
    const rows = within(within(overdue).getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3); // header, the owner of the lapsed one first, then the owner of the review due one
    expect(within(rows[1]).getByText("Abe Admin")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Cam Manager")).toBeInTheDocument();
  });

  it("says nothing is overdue, with no table, when nothing is", async () => {
    dataset.careEngagements.length = 0;
    signInAs(ADMIN_USER);
    await renderServerRoute(activePage, undefined as never);
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("Nothing is overdue.")).toBeInTheDocument();
    expect(within(overdue).queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks a lapsed engagement and offers it a renewal from Earlier, and narrows Earlier to lapsed or closed", async () => {
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "All (3)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Lapsed (1)" }));
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText("Lapsed")).toBeInTheDocument();
    expect(within(cards()[0]).getByText(/nobody renewed or closed it/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Closed (2)" }));
    expect(cards()).toHaveLength(2);
  });
});

describe("the owner filter", () => {
  it("narrows to Mine and back to Everyone, counts shown beside each owner's avatar, and writes the choice to the address", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    expect(cards()).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(cards().map((c) => within(c).getAllByRole("link")[0].textContent)).toEqual(["Ada E.", "Ada E.", "Cy Example"]);
    expect(window.location.search).toBe("?owner=me");
    expect(screen.getByRole("button", { name: "All (3)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Everyone" }));
    expect(cards()).toHaveLength(4);
    expect(window.location.search).toBe("");
  });

  it("shows one avatar chip per owner with their count, and a click filters to them and a second click clears it", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    const owners = within(screen.getByRole("list", { name: "Owners" }));
    expect(owners.getAllByRole("button")).toHaveLength(2);
    await user.click(owners.getByRole("button", { name: "Abe Admin, 1" }));
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText("Owner: Abe Admin")).toBeInTheDocument();
    expect(window.location.search).toBe(`?owner=${ADMIN_USER.id}`);
    expect(owners.getByRole("button", { name: "Abe Admin, 1" })).toHaveAttribute("aria-pressed", "true");

    await user.click(owners.getByRole("button", { name: "Abe Admin, 1" }));
    expect(cards()).toHaveLength(4);
  });

  it("finds an owner by name in the search, and clears with the search emptied", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    await user.type(screen.getByRole("combobox", { name: "Find an owner" }), "abe");
    await user.click(await screen.findByRole("option", { name: /Abe Admin/ }));
    expect(cards()).toHaveLength(1);
    expect(window.location.search).toBe(`?owner=${ADMIN_USER.id}`);
  });

  it("starts from the owner in the address, so a reload or a shared link lands on it", async () => {
    window.history.replaceState(null, "", `/admin/care?owner=${CM_USER.id}`);
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    expect(cards()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Cam Manager, 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("can show the engagements nobody owns", async () => {
    dataset.careEngagements[0].owned_by = null;
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole("list", { name: "Owners" })).getByRole("button", { name: "Unassigned, 1" }));
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText("Owner: Unassigned")).toBeInTheDocument();
    expect(window.location.search).toBe("?owner=unassigned");
  });

  it("filters Earlier on its own, the same way", async () => {
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);
    const user = userEvent.setup();

    expect(cards()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(cards()).toHaveLength(2); // the lapsed one is Abe's
  });
});

describe("handing an engagement over", () => {
  it("lists the team, hands it to the one picked and refreshes", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Reassign" }));
    await user.click(within(ada).getByRole("combobox", { name: "Hand it to" }));
    await user.click(await within(ada).findByRole("option", { name: /Abe Admin/ }));

    expect(actions.reassignEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2", ADMIN_USER.id);
  });

  it("shows the refusal from the server", async () => {
    actions.reassignEngagement.mockResolvedValue({ error: "Pick someone on the team." });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Reassign" }));
    await user.click(within(ada).getByRole("combobox", { name: "Hand it to" }));
    await user.click(await within(ada).findByRole("option", { name: /Abe Admin/ }));

    expect(await within(ada).findByRole("alert")).toHaveTextContent("Pick someone on the team.");
  });

  it("does not offer the current owner", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0]; // Cam's

    await user.click(within(ada).getByRole("button", { name: "Reassign" }));
    await user.click(within(ada).getByRole("combobox", { name: "Hand it to" }));
    expect(await within(ada).findByRole("option", { name: /Abe Admin/ })).toBeInTheDocument();
    expect(within(ada).queryByRole("option", { name: /Cam Manager/ })).not.toBeInTheDocument();
    expect(actions.reassignEngagement).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Slack DMs (docs/HEDGIE_CARE.md, "Slack DMs fill it in")
// ---------------------------------------------------------------------------------------------------------------------

const CM_MEMBER = "mbr_AAAAAAAAAAA8";
const STAFF_MEMBER = "mbr_AAAAAAAAAAB1";
const U = { cm: "U0CM00001", ada: "U0ADA0001", bo: "U0BO00001", staff: "U0STAFF01", other: "U0OTHER01" };
const D = { ada: "D0ADA0001", bo: "D0BO00001", staff: "D0STAFF01", others: "D0OTHERS1" };
const SECRET_TEXT = "a sentence nobody should read here";
const dmMessage = (channel_id: string, user_id: string, occurred_at: string) => ({ channel_id, message_ts: `${Date.parse(occurred_at) / 1000}.000100`, user_id, occurred_at, text: SECRET_TEXT });
const inChannel = (channel_id: string, ...users: string[]) => users.map((user_id) => ({ channel_id, user_id, left_at: null, imported_at: ago(30) }));

/** The seeded world plus Slack: Cam (the community manager) connected with DM permissions, DMs with Ada, Bo and a staff member, and one between Ada and Bo. */
function seedSlack({ bridge = true, connection = "ok" }: { bridge?: boolean; connection?: "ok" | "none" | "no_scopes" } = {}) {
  dataset.members.push({ ...dataset.members[0], id: STAFF_MEMBER, name: "Sam Staffer", displayName: null, email: "sam@example.test", userId: null });
  dataset.staff.push({ id: "staff_AAAAAAAAAAA1", email: "sam@example.test", name: "Sam Staffer", role: "host", member_id: STAFF_MEMBER, hire_date: null, notes: null, created_at: null, updated_at: null });
  dataset.chatSlackAuthors.push(
    { slack_user_id: U.cm, member_id: CM_MEMBER },
    { slack_user_id: U.ada, member_id: ADA },
    { slack_user_id: U.bo, member_id: BO },
    { slack_user_id: U.staff, member_id: STAFF_MEMBER }
  );
  if (connection !== "none") {
    dataset.slackConnections.push({
      member_id: CM_MEMBER,
      slack_user_id: U.cm,
      team_id: null,
      scopes: connection === "ok" ? [...SLACK_DM_SCOPES] : ["chat:write"],
      connected_at: ago(30),
      revoked_at: null,
      access_secret_id: null,
      refresh_secret_id: null,
      expires_at: null,
      dms_completed_at: null, dms_pulled_at: null,
      read_pulled_at: null,
    });
  }
  dataset.slackChannels.push(...[D.ada, D.bo, D.staff, D.others].map((channel_id) => ({ channel_id, name: "", is_im: true, is_private: true })));
  dataset.slackChannelMembers.push(...inChannel(D.ada, U.cm, U.ada), ...inChannel(D.bo, U.bo, U.cm), ...inChannel(D.staff, U.cm, U.staff), ...inChannel(D.others, U.ada, U.bo));
  dataset.slackMessages.push(
    dmMessage(D.ada, U.ada, ago(1)),
    dmMessage(D.ada, U.cm, ago(3)),
    dmMessage(D.bo, U.cm, ago(6)),
    dmMessage(D.staff, U.staff, ago(0.5)),
    dmMessage(D.others, U.bo, ago(0.2))
  );
  if (bridge) dataset.featureFlags.push({ feature_key: "slack_dm_bridge", enabled_globally: true, created_at: ago(30), updated_at: ago(30) });
}

describe("the Your DMs tab", () => {
  beforeEach(() => {
    actions.trackCareDm.mockResolvedValue({ success: true });
    actions.untrackCareDm.mockResolvedValue({ success: true });
  });

  const rows = () => screen.getAllByRole("listitem").filter((li) => li.querySelector("a[href^='/admin/members/']") && li.querySelector("button[aria-pressed]"));

  it("is the third tab, at its own path, and opens for a community manager and an admin but not a member", async () => {
    seedSlack();
    signInAs(CM_USER);
    const first = await renderServerRoute(activePage, undefined as never);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Active (4)", "Earlier (1 lapsed)", "Your DMs"]);
    first.unmount();

    signInAs(ADMIN_USER);
    await renderServerRoute(dmsPage, undefined as never);
    expect(screen.getAllByRole("tab", { selected: true })[0]).toHaveTextContent("Your DMs");

    signInAs(null);
    await expectRedirect(dmsPage, undefined as never, "/login");
    signInAs(MEMBER_USER);
    await expectRedirect(dmsPage, undefined as never, "/no-access");
  });

  it("lists only her own DMs with members: newest first, by display name, who wrote last, and not a staff member's or other people's", async () => {
    seedSlack();
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);

    expect(rows().map((r) => r.querySelector("a")?.textContent)).toEqual(["Ada E.", "Bo Example"]);
    expect(within(rows()[0]).getByText("Ada Example")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("They wrote last, yesterday")).toBeInTheDocument();
    expect(within(rows()[1]).getByText("You wrote last, 6 days ago")).toBeInTheDocument();
    expect(within(rows()[0]).getByRole("link", { name: "Ada E." })).toHaveAttribute("href", `/admin/members/${ADA}`);
    expect(screen.queryByText(/Sam Staffer/)).not.toBeInTheDocument();
    expect(screen.queryByText(SECRET_TEXT)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(D.others);
    expect(document.body.innerHTML).not.toContain(D.staff);
  });

  it("says, in plain words, what is and is not read", async () => {
    seedSlack();
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);

    expect(screen.getByText(/reads who wrote and when in the DMs you track, never what was said/)).toBeInTheDocument();
    expect(screen.getByText(/already brings your direct messages in for Hub Chat/)).toBeInTheDocument();
    expect(screen.getByText(/Other staff, admins included, don.t see which DMs you track/)).toBeInTheDocument();
    expect(screen.getByText(/DMs with staff are never listed/)).toBeInTheDocument();
    // The team can read these in Hub Chat (the privacy page says so), and Hedgie Care itself stays metadata only.
    expect(screen.getByText(/can be read by the team in Hub Chat, as the privacy page says\. Hedgie\s+Care itself still reads only who wrote and when/)).toBeInTheDocument();
  });

  it("marks the DMs she tracks, and tracks and untracks with a click, counting how many she tracks and nothing else", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.bo, member_id: BO, created_at: ago(2), deleted_at: null });
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);
    const user = userEvent.setup();

    expect(within(rows()[0]).getByRole("button", { name: "Track your DM with Ada E." })).toHaveAttribute("aria-pressed", "false");
    expect(within(rows()[1]).getByRole("button", { name: "Stop tracking your DM with Bo Example" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tracked (1)" })).toBeInTheDocument();

    await user.click(within(rows()[0]).getByRole("button", { name: "Track your DM with Ada E." }));
    await waitFor(() => expect(within(rows()[0]).getByRole("button", { name: "Stop tracking your DM with Ada E." })).toHaveAttribute("aria-pressed", "true"));
    expect(actions.trackCareDm).toHaveBeenCalledWith(D.ada);
    expect(track).toHaveBeenCalledWith("care_dm_tracked", { dms_tracked: 2 });
    expect(screen.getByRole("button", { name: "Tracked (2)" })).toBeInTheDocument();

    await user.click(within(rows()[1]).getByRole("button", { name: "Stop tracking your DM with Bo Example" }));
    await waitFor(() => expect(within(rows()[1]).getByRole("button", { name: "Track your DM with Bo Example" })).toBeInTheDocument());
    expect(actions.untrackCareDm).toHaveBeenCalledWith(D.bo);
    expect(track).toHaveBeenCalledWith("care_dm_untracked", { dms_tracked: 1 });
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/Ada|Bo |D0|mbr_/);
  });

  it("shows why it could not track one, and leaves the switch as it was", async () => {
    seedSlack();
    actions.trackCareDm.mockResolvedValue({ error: "Couldn't track that DM." });
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);

    await userEvent.setup().click(within(rows()[0]).getByRole("button", { name: "Track your DM with Ada E." }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't track that DM.");
    expect(within(rows()[0]).getByRole("button", { name: "Track your DM with Ada E." })).toHaveAttribute("aria-pressed", "false");
    expect(track).not.toHaveBeenCalled();
  });

  it("finds a DM by name, narrows to the tracked ones, and says when nothing matches", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.bo, member_id: BO, created_at: ago(2), deleted_at: null });
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "Find a DM by name" }), "ada ex");
    expect(rows().map((r) => r.querySelector("a")?.textContent)).toEqual(["Ada E."]); // by legal name too
    await user.clear(screen.getByRole("searchbox", { name: "Find a DM by name" }));
    await user.click(screen.getByRole("button", { name: "Tracked (1)" }));
    expect(rows().map((r) => r.querySelector("a")?.textContent)).toEqual(["Bo Example"]);
    await user.type(screen.getByRole("searchbox", { name: "Find a DM by name" }), "zzz");
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("pages a long list", async () => {
    seedSlack();
    for (let i = 0; i < 30; i++) {
      const member = `mbr_ZZZZZZZZZZ${String(i).padStart(2, "0")}`;
      dataset.members.push({ ...dataset.members[0], id: member, name: `Pat ${String(i).padStart(2, "0")} Example`, displayName: null, email: `pat${i}@example.test`, userId: null });
      dataset.chatSlackAuthors.push({ slack_user_id: `U0PAT${i}`, member_id: member });
      dataset.slackChannels.push({ channel_id: `D0PAT${i}`, name: "", is_im: true, is_private: true });
      dataset.slackChannelMembers.push(...inChannel(`D0PAT${i}`, U.cm, `U0PAT${i}`));
    }
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);

    expect(rows()).toHaveLength(25);
    expect(screen.getByRole("button", { name: "All (32)" })).toBeInTheDocument();
  });

  it("has no switches without the write feature", async () => {
    seedSlack();
    const granted = [...COMMUNITY_MANAGER_FEATURES];
    (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).splice(0);
    try {
      signInAs(CM_USER);
      await renderServerRoute(dmsPage, undefined as never);
      expect(screen.getByText("Ada E.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Track your DM/ })).not.toBeInTheDocument();
    } finally {
      (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).push(...granted);
    }
  });

  it("explains an empty list", async () => {
    seedSlack();
    dataset.slackChannelMembers.length = 0;
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);
    expect(screen.getByText(/No direct messages with members yet/)).toBeInTheDocument();
  });

  describe("when it can't show the list", () => {
    it("explains that the bridge is not on for her yet, without a connect button", async () => {
      seedSlack({ bridge: false });
      signInAs(CM_USER);
      await renderServerRoute(dmsPage, undefined as never);
      expect(screen.getByText(/aren.t switched on for your account yet/)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Connect Slack/ })).not.toBeInTheDocument();
      expect(screen.getByText(/reads who wrote and when/)).toBeInTheDocument();
    });

    it("sends her through the existing Slack connect flow and back to this tab when Slack is not connected", async () => {
      seedSlack({ connection: "none" });
      signInAs(CM_USER);
      await renderServerRoute(dmsPage, undefined as never);
      expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start?next=%2Fadmin%2Fcare%2Fdms");
    });

    it("asks her to reconnect when the connection lacks the DM permissions", async () => {
      seedSlack({ connection: "no_scopes" });
      signInAs(CM_USER);
      await renderServerRoute(dmsPage, undefined as never);
      expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start?next=%2Fadmin%2Fcare%2Fdms");
    });

    it("says an account with no member profile has no Slack to connect", async () => {
      seedSlack();
      dataset.members.find((m) => m.id === CM_MEMBER)!.userId = null;
      signInAs(CM_USER);
      await renderServerRoute(dmsPage, undefined as never);
      expect(screen.getByText(/no member profile/)).toBeInTheDocument();
    });
  });

  it("reads her DMs only when this tab is the one asked for: from another tab it is a link that opens it", async () => {
    seedSlack();
    const reads: string[] = [];
    const original = dataset.slackMessages;
    Object.defineProperty(dataset, "slackMessages", { get: () => (reads.push("read"), original), set: () => {} });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Your DMs" }));

    expect(screen.getByRole("link", { name: "Open your DMs" })).toHaveAttribute("href", "/admin/care/dms");
    expect(reads).toEqual([]);
  });
});

describe("Slack DMs on the engagement list", () => {
  it("fills in who spoke last from a tracked DM when she opens the page, and the status follows", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: ago(2), deleted_at: null });
    // Ada's engagement is on Slack DM, opened 10 days ago; she wrote 3 days ago, Ada yesterday.
    dataset.careEngagements.splice(0, dataset.careEngagements.length, row("care_AAAAAAAAAAA1", ADA, { period_ends_on: "2026-04-10", last_staff_message_at: ago(10) }));
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const card = cards()[0];
    expect(within(card).getByText("Needs your reply")).toBeInTheDocument();
    expect(within(card).getByText(/Last message: they wrote yesterday/)).toBeInTheDocument();
    expect(within(card).getByText("from Slack")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs your reply (1)" })).toBeInTheDocument();
  });

  it("does not look at DMs she does not track, and shows no hint for an engagement that does not follow one", async () => {
    seedSlack();
    dataset.careEngagements.splice(0, dataset.careEngagements.length, row("care_AAAAAAAAAAA1", ADA, { last_staff_message_at: ago(10) }));
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const card = cards()[0];
    expect(within(card).getByText("Waiting on them")).toBeInTheDocument();
    expect(within(card).queryByText("from Slack")).not.toBeInTheDocument();
  });

  it("shows the hint only on her own open Slack DM engagements with a member whose DM she tracks", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: ago(2), deleted_at: null });
    dataset.careEngagements.splice(
      0,
      dataset.careEngagements.length,
      row("care_AAAAAAAAAAA1", ADA, { channel: "email" }), // another channel
      row("care_AAAAAAAAAAA2", BO, {}), // a DM she does not track
      row("care_AAAAAAAAAAA3", ADA, { channel: "prickle" }),
      row("care_AAAAAAAAAAA4", ADA, { owned_by: ADMIN_USER.id, channel: "slack_dm" }) // someone else's
    );
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(screen.queryAllByText("from Slack")).toHaveLength(0);
  });

  it("does not stop the page opening when reading her tracked DMs fails", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: ago(2), deleted_at: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = dataset.slackMessages;
    Object.defineProperty(dataset, "slackMessages", {
      get: () => {
        throw new Error("bronze is down");
      },
      set: () => {},
    });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    Object.defineProperty(dataset, "slackMessages", { value: original, writable: true, configurable: true });

    expect(cards().length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith("[care] filling in from tracked DMs failed:", "bronze is down");
  });
});


describe("changing when a care period started", () => {
  const adaCard = () => cards()[0]; // Ada's Email care period: started 10 days ago (2026-03-10 in Eastern time)

  it("shows the day it started next to the day it ends", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    expect(within(adaCard()).getByText(/· Started 3\/10\/2026/)).toBeInTheDocument();
  });

  it("opens a date with today as its limit, saves the day she picks, and reports how far it moved", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    await user.click(within(adaCard()).getByRole("button", { name: "Change start date" }));
    const date = within(adaCard()).getByLabelText("When did this start?");
    expect(date).toHaveValue("2026-03-10");
    expect(date).toHaveAttribute("max", "2026-03-20");
    expect(within(adaCard()).getByText(/The care period stays the same length, so its last day moves with the start/)).toBeInTheDocument();
    fireEvent.change(date, { target: { value: "2026-03-05" } });
    await user.click(within(adaCard()).getByRole("button", { name: "Save start date" }));

    expect(actions.changeEngagementStart).toHaveBeenCalledWith("care_AAAAAAAAAAA2", "2026-03-05");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_start_date_changed", { days_moved: 5 }));
    await waitFor(() => expect(within(adaCard()).queryByLabelText("When did this start?")).not.toBeInTheDocument());
  });

  it("says why the server refused and keeps the panel open, without reporting a change", async () => {
    actions.changeEngagementStart.mockResolvedValue({ error: "The start can't be before the care period this one follows on from, which started on 3/5/2026." });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    await user.click(within(adaCard()).getByRole("button", { name: "Change start date" }));
    fireEvent.change(within(adaCard()).getByLabelText("When did this start?"), { target: { value: "2026-03-01" } });
    await user.click(within(adaCard()).getByRole("button", { name: "Save start date" }));

    expect(await within(adaCard()).findByRole("alert")).toHaveTextContent("The start can't be before the care period this one follows on from");
    expect(track).not.toHaveBeenCalled();
  });

  it("will not save without a day, and is not offered to someone who cannot write", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    await user.click(within(adaCard()).getByRole("button", { name: "Change start date" }));
    fireEvent.change(within(adaCard()).getByLabelText("When did this start?"), { target: { value: "" } });
    await user.click(within(adaCard()).getByRole("button", { name: "Save start date" }));
    expect(within(adaCard()).getByRole("alert")).toHaveTextContent("Pick the day it started.");
    expect(actions.changeEngagementStart).not.toHaveBeenCalled();
  });

  it("mentions the tracked DM only for a Slack DM, and the order of a renewal only for a renewal", async () => {
    dataset.careEngagements.splice(0, dataset.careEngagements.length, row("care_AAAAAAAAAAA1", ADA, { renewed_from: "care_AAAAAAAAAAA0" }), row("care_AAAAAAAAAAA2", BO, { channel: "email" }));
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();

    const [renewal, email] = cards();
    await user.click(within(renewal).getByRole("button", { name: "Change start date" }));
    expect(within(renewal).getByText(/If you track your Slack DM with them, DMs from that day on are used/)).toBeInTheDocument();
    expect(within(renewal).getByText(/The start can't be before the care period this one follows on from/)).toBeInTheDocument();
    await user.click(within(email).getByRole("button", { name: "Change start date" }));
    expect(within(email).queryByText(/If you track your Slack DM/)).not.toBeInTheDocument();
    expect(within(email).queryByText(/continues/)).not.toBeInTheDocument();
  });
});

describe("the engagement score and last time in the community", () => {
  const activity = (member: string, type: string, at: string, points: number, over: Record<string, unknown> = {}) => ({
    id: `act_${type}_${at}_${member}`.slice(0, 40),
    member_id: member,
    activity_type: type,
    activity_category: "event",
    title: type,
    occurred_at: at,
    source: "slack",
    related_id: null,
    description: null,
    engagement_value: points,
    actor_kind: "member",
    actor_user_id: null,
    acting_as_member_id: null,
    duration_minutes: null,
    prickle_id: null,
    data: null,
    created_at: at,
    ...over,
  });

  it("shows the score when the care period started and now, with its tier, and when they last took part and in what", async () => {
    dataset.activities.push(
      activity(ADA, "slack_message", ago(20), 4), // inside the 30 days before it started, and before now
      activity(ADA, "prickle_attended", ago(3), 10),
      activity(ADA, "slack_reaction", ago(1), 2),
      activity(ADA, "hedgie_hub_login", ago(0.1), 1), // a login scores a point but is not taking part
      activity(ADA, "care_started", ago(0.05), 0, { actor_kind: "staff", source: "care" }) // staff: neither
    );
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const ada = cards()[0];
    expect(ada.textContent).toContain("Engagement score: 4 (At risk) when the care period started, 17 (Active) now");
    expect(ada.textContent).toContain("Last in the community: 3/19/2026, a Slack reaction (yesterday)");
  });

  it("keeps the DM line apart from both and names them differently", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const ada = cards()[0];
    expect(within(ada).getByText(/Last message: they wrote yesterday/)).toBeInTheDocument();
    expect(ada.textContent).toContain("Last in the community: none recorded");
    expect(ada.textContent).toContain("Engagement score: 0 (At risk) when the care period started, 0 (At risk) now");
  });

  it("says what each one counts, as a tooltip on the row and in full in the results", async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0];

    expect(within(ada).getByText("Engagement score")).toHaveAttribute("title", expect.stringContaining("never more than 100. A prickle is worth 10"));
    expect(within(ada).getByText("Last in the community")).toHaveAttribute("title", expect.stringContaining("Not signing in, and nothing staff or the Hub did"));
    expect(within(ada).queryByText(/Under 10 is at risk, 10 to 49 is active, 50 or more is highly engaged/)).not.toBeInTheDocument();

    await user.click(within(ada).getByRole("button", { name: "Results" }));
    expect(await within(ada).findByText(/Under 10 is at risk, 10 to 49 is active, 50 or more is highly engaged/)).toBeInTheDocument();
    expect(within(ada).getAllByText(/Engagement score/).length).toBeGreaterThan(1);
  });

  it("still opens the page when the score cannot be worked out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(dataset, "activities", { get: () => { throw new Error("log is down"); }, set: () => {}, configurable: true });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(cards()[0].textContent).toContain("Engagement score: not available");
    expect(cards()[0].textContent).toContain("Last in the community: not available");
    expect(log).toHaveBeenCalledWith("[care] working out scores failed:", "log is down");
    expect(log).toHaveBeenCalledWith("[care] reading last participation failed:", "log is down");
  });
});

describe("Open the DM", () => {
  const CHANNEL = "chn_AAAAAAAAAAA1";
  const trackAda = () => {
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: ago(2), deleted_at: null });
    dataset.careEngagements.splice(0, dataset.careEngagements.length, row("care_AAAAAAAAAAA1", ADA));
  };
  afterEach(() => vi.unstubAllEnvs());

  it("opens the DM in Hub Chat on the engagement when she is in it there, and on the DMs tab", async () => {
    seedSlack();
    trackAda();
    dataset.chatChannels.push({ id: CHANNEL, slack_channel_id: D.ada, kind: "dm", visibility: "private" });
    dataset.chatChannelMembers.push({ channel_id: CHANNEL, member_id: CM_MEMBER, source: "slack", left_at: null });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(within(cards()[0]).getByRole("link", { name: "Open the DM" })).toHaveAttribute("href", `/chat/${CHANNEL}`);
  });

  it("opens it in Slack when the Hub does not have it for her, naming the workspace only when it is configured", async () => {
    seedSlack();
    trackAda();
    vi.stubEnv("SLACK_TEAM_ID", "T0TEST");
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const link = within(cards()[0]).getByRole("link", { name: "Open the DM" });
    expect(link).toHaveAttribute("href", `https://slack.com/app_redirect?channel=${D.ada}&team=T0TEST`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("names no workspace when none is configured, and never puts text from the DM in the link", async () => {
    seedSlack();
    trackAda();
    vi.stubEnv("SLACK_TEAM_ID", "");
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    const link = within(cards()[0]).getByRole("link", { name: "Open the DM" });
    expect(link).toHaveAttribute("href", `https://slack.com/app_redirect?channel=${D.ada}`);
    expect(document.body.innerHTML).not.toContain(SECRET_TEXT);
  });

  it("is only on a Slack DM engagement she owns with a member whose DM she tracks", async () => {
    seedSlack();
    dataset.careTrackedDms.push({ id: "caredm_AAAAAAAAAAA1", tracked_by: CM_USER.id, slack_channel_id: D.ada, member_id: ADA, created_at: ago(2), deleted_at: null });
    dataset.careEngagements.splice(
      0,
      dataset.careEngagements.length,
      row("care_AAAAAAAAAAA1", ADA, { channel: "email" }), // another channel
      row("care_AAAAAAAAAAA2", BO, {}), // a DM she does not track
      row("care_AAAAAAAAAAA3", ADA, { owned_by: ADMIN_USER.id }) // someone else's
    );
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(screen.queryAllByRole("link", { name: "Open the DM" })).toHaveLength(0);
  });

  it("is also on a closed care period of a tracked DM", async () => {
    seedSlack();
    trackAda();
    dataset.careEngagements[0].closed_at = ago(1);
    dataset.careEngagements[0].ended_how = "ran_its_course";
    signInAs(CM_USER);
    await renderServerRoute(earlierPage, undefined as never);

    expect(within(cards()[0]).getByRole("link", { name: "Open the DM" })).toBeInTheDocument();
  });

  it("is on each row of the DMs tab", async () => {
    seedSlack();
    dataset.chatChannels.push({ id: CHANNEL, slack_channel_id: D.ada, kind: "dm", visibility: "private" });
    dataset.chatChannelMembers.push({ channel_id: CHANNEL, member_id: CM_MEMBER, source: "slack", left_at: null });
    signInAs(CM_USER);
    await renderServerRoute(dmsPage, undefined as never);

    const rows = screen.getAllByRole("listitem").filter((li) => li.querySelector("a[href^='/admin/members/']") && li.querySelector("button[aria-pressed]"));
    expect(within(rows[0]).getByRole("link", { name: "Open the DM" })).toHaveAttribute("href", `/chat/${CHANNEL}`); // Ada: in Hub Chat
    expect(within(rows[1]).getByRole("link", { name: "Open the DM" })).toHaveAttribute("href", `https://slack.com/app_redirect?channel=${D.bo}`); // Bo: Slack
  });

  it("does not stop the page opening when finding the links fails", async () => {
    seedSlack();
    trackAda();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(dataset, "chatChannels", { get: () => { throw new Error("chat is down"); }, set: () => {}, configurable: true });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    expect(cards().length).toBeGreaterThan(0);
    expect(within(cards()[0]).queryByRole("link", { name: "Open the DM" })).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledWith("[care] resolving DM links failed:", "chat is down");
  });
});
