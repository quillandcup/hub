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

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
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
  deleteEngagement: vi.fn(),
  getEngagementResults: vi.fn(),
  searchCareMembers: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/care/actions", () => actions);

import CareIndex from "@/app/(admin)/admin/care/page";
import CareEarlierPage from "@/app/(admin)/admin/care/earlier/page";

const activePage = () => CareIndex({ searchParams: Promise.resolve({}) } as never);
const earlierPage = () => CareEarlierPage();

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const NOW = Date.parse("2026-03-20T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const row = (id: string, member: string, over: Record<string, unknown> = {}) => ({
  id,
  member_id: member,
  opened_by: null,
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
    ],
    userProfiles: [
      { id: ADMIN_USER.id, email: ADMIN_USER.email!, role: "admin" },
      { id: MEMBER_USER.id, email: MEMBER_USER.email!, role: "member" },
      { id: CM_USER.id, email: CM_USER.email, role: "community_manager" },
    ],
  });
  dataset.careEngagements.push(
    row("care_AAAAAAAAAAA1", BO, { last_staff_message_at: ago(2) }), // waiting on them
    row("care_AAAAAAAAAAA2", ADA, { channel: "email", last_staff_message_at: ago(5), last_member_message_at: ago(1), next_step: "Ask about chapter two", follow_up_on: "2026-03-19", notes: "Mentioned her draft." }), // needs a reply, follow-up overdue
    row("care_AAAAAAAAAAA3", CY, { opened_at: ago(60), last_staff_message_at: ago(40) }), // gone quiet
    row("care_AAAAAAAAAAA4", CY, { channel: "email", closed_at: ago(3), ended_how: "back_in_community" }), // closed lately
    row("care_AAAAAAAAAAA5", BO, { channel: "email", closed_at: ago(90), ended_how: "no_reply" }), // closed long ago
    row("care_AAAAAAAAAAA6", BO, { channel: "prickle", deleted_at: ago(1) }), // removed: not listed
    row("care_AAAAAAAAAAA7", ADA, { period_ends_on: "2026-03-15", last_staff_message_at: ago(8) }), // period over, inside the grace: review due
    row("care_AAAAAAAAAAA8", CY, { channel: "prickle", period_ends_on: "2026-02-01", opened_at: ago(60), last_staff_message_at: ago(55) }), // lapsed
  );
}

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
  actions.deleteEngagement.mockResolvedValue({ success: true });
  actions.searchCareMembers.mockResolvedValue([{ id: BO, name: "Bo Example", detail: "bo@example.test" }]);
  track.mockClear();
  seed();
});
afterEach(() => vi.useRealTimers());

const cards = () => screen.getAllByRole("listitem");

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
    expect(within(ada).getByText("A check-in · Email")).toBeInTheDocument();
    expect(within(cards()[3]).getByText(/You wrote 2 days ago/)).toBeInTheDocument();
    expect(within(cards()[1]).getByText("The period is over. Renew it to keep going, or close it.")).toBeInTheDocument();
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

    expect(screen.getByRole("tab", { name: "Earlier" })).toHaveAttribute("aria-selected", "true");
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

  it("renews, and reports it with how many days the period had run", async () => {
    const user = await open();

    await user.click(within(cards()[0]).getByRole("button", { name: "Renew" }));

    expect(actions.renewEngagement).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    await waitFor(() => expect(track).toHaveBeenCalledWith("care_engagement_renewed", { days_open: 10 }));
  });

  it("shows why a renewal was refused and does not report it", async () => {
    actions.renewEngagement.mockResolvedValue({ error: "That engagement is already renewed, closed or gone. Refresh the list." });
    const user = await open();

    await user.click(within(cards()[0]).getByRole("button", { name: "Renew" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("already renewed");
    expect(track).not.toHaveBeenCalled();
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

  it("closes with how it ended, asking for one first, and never offers 'renewed'", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Close" }));
    await user.click(within(ada).getByRole("button", { name: "Close engagement" }));
    expect(within(ada).getByRole("alert")).toHaveTextContent("Pick how it ended.");
    expect(actions.closeEngagement).not.toHaveBeenCalled();

    const options = within(within(ada).getByLabelText("How did it end?")).getAllByRole("option").map((o) => o.textContent);
    expect(options).not.toContain("Renewed");
    expect(options).toContain("Back in the community");

    await user.selectOptions(within(ada).getByLabelText("How did it end?"), "back_in_community");
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
  const counts = (n: number) => ({ pricklesAttended: n, slackMessages: n + 1, firstPrickle: n === 2, firstSlackPost: false, peopleConnected: n + 2 });
  const window = (name: "before" | "during" | "after", state: "complete" | "so_far" | "not_yet") => ({
    name,
    from: "2026-02-01T05:00:00.000Z",
    to: "2026-03-01T05:00:00.000Z",
    state,
  });
  const results = {
    before: { window: window("before", "complete"), counts: counts(1) },
    during: { window: window("during", "so_far"), counts: counts(2) },
    after: { window: window("after", "not_yet"), counts: null },
  };

  it("loads on request, shows the three windows and the honest limits, and loads once", async () => {
    actions.getEngagementResults.mockResolvedValue({ results });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    const user = userEvent.setup();
    const ada = cards()[0];

    expect(actions.getEngagementResults).not.toHaveBeenCalled();
    await user.click(within(ada).getByRole("button", { name: "Results" }));

    expect(await within(ada).findByRole("table")).toBeInTheDocument();
    expect(actions.getEngagementResults).toHaveBeenCalledWith("care_AAAAAAAAAAA2");
    const rows = within(ada).getAllByRole("row");
    expect(rows).toHaveLength(4); // header and three windows
    expect(within(rows[1]).getByText("Before")).toBeInTheDocument();
    expect(within(rows[2]).getByText(/so far/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("first prickle")).toBeInTheDocument();
    expect(within(rows[1]).getByText("None")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Not yet")).toBeInTheDocument();
    expect(within(ada).getByText(/read each one as a story, not a score/)).toBeInTheDocument();

    await user.click(within(ada).getByRole("button", { name: "Results" }));
    expect(within(ada).queryByRole("table")).not.toBeInTheDocument();
    await user.click(within(ada).getByRole("button", { name: "Results" }));
    expect(within(ada).getByRole("table")).toBeInTheDocument();
    expect(actions.getEngagementResults).toHaveBeenCalledTimes(1);
  });

  it("shows the error when they can't be counted", async () => {
    actions.getEngagementResults.mockResolvedValue({ error: "Couldn't work out the results." });
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);

    await userEvent.setup().click(within(cards()[0]).getByRole("button", { name: "Results" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("Couldn't work out the results.");
    expect(within(cards()[0]).queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("starting an engagement", () => {
  const open = async () => {
    signInAs(CM_USER);
    await renderServerRoute(activePage, undefined as never);
    return userEvent.setup();
  };

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
    await user.selectOptions(screen.getByLabelText("Why you are reaching out"), "welcome");
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
    await user.selectOptions(screen.getByLabelText("Why you are reaching out"), "introduction");
    await user.type(screen.getByLabelText("Note"), "Hi there");
    await user.click(screen.getByRole("button", { name: "Start engagement" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already an open engagement");
    expect(screen.getByLabelText("Note")).toHaveValue("Hi there");
    expect(track).not.toHaveBeenCalled();
  });
});
