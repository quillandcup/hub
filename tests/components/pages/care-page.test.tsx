// @vitest-environment jsdom
/**
 * Hedgie Care (app/(admin)/admin/care): staff only, what needs her reply first on the Active tab, closed and lapsed
 * engagements under Earlier, and the controls that call the server actions. Data comes from the in-memory repository; the actions are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
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
  logCareMessage: vi.fn(),
  updateEngagement: vi.fn(),
  closeEngagement: vi.fn(),
  renewEngagement: vi.fn(),
  reassignEngagement: vi.fn(),
  deleteEngagement: vi.fn(),
  getEngagementResults: vi.fn(),
  searchCareMembers: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/care/actions", () => actions);

import CareIndex from "@/app/(admin)/admin/care/page";
import CareEarlierPage from "@/app/(admin)/admin/care/earlier/page";

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const activePage = () => CareIndex({ searchParams: Promise.resolve({}) } as never);
const earlierPage = () => CareEarlierPage();

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
    expect(within(ada).getByText(/They wrote yesterday/)).toBeInTheDocument();
    expect(within(ada).getByText(/Period ends/)).toBeInTheDocument();
    expect(within(ada).getByText("Follow up due")).toBeInTheDocument();
    expect(within(ada).getByText(/· Follow up \w+/)).toBeInTheDocument();
    expect(within(ada).getByText("Next: Ask about chapter two")).toBeInTheDocument();
    expect(within(ada).getByText("Mentioned her draft.")).toBeInTheDocument();
    expect(within(ada).getByText("A check-in · Email · Period 1")).toBeInTheDocument();
    expect(within(ada).getByText("Owner: Cam Manager")).toBeInTheDocument();
    expect(within(cards()[3]).getByText("Owner: Abe Admin")).toBeInTheDocument();
    expect(within(cards()[3]).getByText(/You wrote 2 days ago/)).toBeInTheDocument();
    expect(within(cards()[1]).getByText("The period is over. Renew it if there is a plan, or close it.")).toBeInTheDocument();
    expect(within(cards()[1]).getByText(/Period ended/)).toBeInTheDocument();
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
    expect(screen.getByText("Nothing active. Start an engagement above.")).toBeInTheDocument();

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
    expect(screen.getByRole("heading", { name: "Start an engagement" })).toBeInTheDocument();
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
      expect(screen.queryByRole("heading", { name: "Start an engagement" })).not.toBeInTheDocument();
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
    expect(screen.getByText(/of 28 engagements/)).toBeInTheDocument();
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
    actions.logCareMessage.mockResolvedValue({ error: "That engagement is closed or gone." });
    const user = await open();

    await user.click(within(cards()[0]).getByRole("button", { name: "They replied" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("That engagement is closed or gone.");
    expect(track).not.toHaveBeenCalled();
  });

  it("asks why before renewing, shows the results at that moment, then renews with the reason and reports it", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Renew" }));
    expect((await within(ada).findAllByRole("table")).length).toBe(2); // the measured results, loaded for the decision
    expect(actions.getEngagementResults).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    expect(actions.renewEngagement).not.toHaveBeenCalled();

    await user.click(within(ada).getByRole("button", { name: "Renew engagement" }));
    expect(within(ada).getByRole("alert")).toHaveTextContent("Say why you are renewing");
    expect(actions.renewEngagement).not.toHaveBeenCalled();

    await user.type(within(ada).getByLabelText("Why renew? What is the plan?"), "A writing sprint in April");
    await user.click(within(ada).getByRole("button", { name: "Renew engagement" }));

    expect(actions.renewEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2", "A writing sprint in April");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_renewed", { days_open: 10 }));
  });

  it("shows why a renewal was refused and does not report it", async () => {
    actions.renewEngagement.mockResolvedValue({ error: "That engagement is already renewed, closed or gone. Refresh the list." });
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Renew" }));
    await user.type(within(ada).getByLabelText("Why renew? What is the plan?"), "A plan");
    await user.click(within(ada).getByRole("button", { name: "Renew engagement" }));

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
    await user.click(within(ada).getByRole("button", { name: "Close engagement" }));
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
    await user.click(within(ada).getByRole("button", { name: "Close engagement" }));

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
    expect(within(checkpoints[1]).getByText("60 days after the period")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Start engagement" }));
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
    await user.click(screen.getByRole("button", { name: "Start engagement" }));

    expect(actions.startEngagement).toHaveBeenCalledWith({ memberId: BO, reason: "welcome", channel: "email", memberWroteFirst: true, notes: "Joined last week", followUpOn: "" });
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_started", { reason: "welcome", channel: "email", member_wrote_first: true }));
    await waitFor(() => expect(screen.getByLabelText("Note")).toHaveValue(""));
  });

  it("keeps what was typed and says why when the server refuses", async () => {
    actions.startEngagement.mockResolvedValue({ error: "There is already an open engagement with them on that channel. Log a message there, or renew it." });
    const user = await open();

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.click(screen.getByRole("radio", { name: /An introduction/ }));
    await user.type(screen.getByLabelText("Note"), "Hi there");
    await user.click(screen.getByRole("button", { name: "Start engagement" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already an open engagement");
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
