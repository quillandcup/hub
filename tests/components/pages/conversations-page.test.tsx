// @vitest-environment jsdom
/**
 * The Conversations page (app/(admin)/admin/conversations): staff only, what needs her reply first, and the
 * controls that call the server actions. Data comes from the in-memory repository; the actions are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

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
  startConversation: vi.fn(),
  logConversationMessage: vi.fn(),
  updateConversation: vi.fn(),
  closeConversation: vi.fn(),
  deleteConversation: vi.fn(),
  searchConversationMembers: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/conversations/actions", () => actions);

import ConversationsPage from "@/app/(admin)/admin/conversations/page";

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
  closed_at: null,
  outcome: null,
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
  dataset.conversations.push(
    row("conv_AAAAAAAAAAA1", BO, { last_staff_message_at: ago(2) }), // waiting on them
    row("conv_AAAAAAAAAAA2", ADA, { channel: "email", last_staff_message_at: ago(5), last_member_message_at: ago(1), next_step: "Ask about chapter two", follow_up_on: "2026-03-19", notes: "Mentioned her draft." }), // needs a reply, follow-up overdue
    row("conv_AAAAAAAAAAA3", CY, { opened_at: ago(60), last_staff_message_at: ago(40) }), // gone quiet
    row("conv_AAAAAAAAAAA4", CY, { channel: "email", closed_at: ago(3), outcome: "re_engaged" }), // closed lately
    row("conv_AAAAAAAAAAA5", BO, { channel: "email", closed_at: ago(90), outcome: "no_response" }), // closed long ago: not listed
    row("conv_AAAAAAAAAAA6", BO, { channel: "prickle", deleted_at: ago(1) }), // removed: not listed
  );
}

// Pinned "now" for the page (lib/clock reads Date) and for the browser's own timing of a close.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetServerPageMocks();
  preview.role = null;
  Object.values(actions).forEach((fn) => fn.mockReset());
  actions.startConversation.mockResolvedValue({ success: true });
  actions.logConversationMessage.mockResolvedValue({ success: true });
  actions.updateConversation.mockResolvedValue({ success: true });
  actions.closeConversation.mockResolvedValue({ success: true });
  actions.deleteConversation.mockResolvedValue({ success: true });
  actions.searchConversationMembers.mockResolvedValue([{ id: BO, name: "Bo Example", detail: "bo@example.test" }]);
  track.mockClear();
  seed();
});
afterEach(() => vi.useRealTimers());

const cards = () => screen.getAllByRole("listitem");

describe("the page", () => {
  it("lists what needs her reply first, then what has gone quiet, then who she waits on, then closed", async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);

    expect(screen.getByRole("heading", { name: "Conversations" })).toBeInTheDocument();
    const names = cards().map((c) => within(c).getAllByRole("link")[0].textContent);
    expect(names).toEqual(["Ada E.", "Cy Example", "Bo Example", "Cy Example"]);
    expect(within(cards()[0]).getByText("Needs your reply")).toBeInTheDocument();
    expect(within(cards()[1]).getByText("Gone quiet")).toBeInTheDocument();
    expect(within(cards()[2]).getByText("Waiting on them")).toBeInTheDocument();
    expect(within(cards()[3]).getByText("Closed")).toBeInTheDocument();
  });

  it("shows the display name first with the legal name beside it, and links to the member", async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);

    const ada = cards()[0];
    expect(within(ada).getByRole("link", { name: "Ada E." })).toHaveAttribute("href", `/admin/members/${ADA}`);
    expect(within(ada).getByText("Ada Example")).toBeInTheDocument();
    expect(within(cards()[2]).queryByText("Bo Example", { selector: "span" })).not.toBeInTheDocument();
  });

  it("says where each one stands: who wrote last and how long ago, the follow-up, the next step, the note", async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);

    const ada = cards()[0];
    expect(within(ada).getByText(/They wrote yesterday/)).toBeInTheDocument();
    expect(within(ada).getByText("Follow up due")).toBeInTheDocument();
    expect(within(ada).getByText(/· Follow up \w+/)).toBeInTheDocument();
    expect(within(ada).getByText("Next: Ask about chapter two")).toBeInTheDocument();
    expect(within(ada).getByText("Mentioned her draft.")).toBeInTheDocument();
    expect(within(ada).getByText("A check-in · Email")).toBeInTheDocument();
    expect(within(cards()[2]).getByText(/You wrote 2 days ago/)).toBeInTheDocument();
    expect(within(cards()[3]).getByText(/Came back, closed 3 days ago/)).toBeInTheDocument();
  });

  it("leaves out conversations closed long ago and removed ones", async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    expect(cards()).toHaveLength(4);
  });

  it("narrows the list by status", async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "All (4)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Needs your reply (1)" }));
    expect(cards()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Closed (1)" }));
    expect(cards()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Gone quiet (1)" }));
    expect(within(cards()[0]).getByText("Gone quiet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All (4)" }));
    expect(cards()).toHaveLength(4);
  });

  it("explains an empty list", async () => {
    dataset.conversations.length = 0;
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    expect(screen.getByText("No conversations yet. Start one above.")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Closed (0)" }));
    expect(screen.queryByText("Nothing here.")).not.toBeInTheDocument();
  });

  it("says nothing here for a status with none", async () => {
    dataset.conversations.splice(0, dataset.conversations.length, row("conv_AAAAAAAAAAA1", BO));
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    await userEvent.setup().click(screen.getByRole("button", { name: "Closed (0)" }));
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("opens for an admin, and for an admin previewing the community manager", async () => {
    signInAs(ADMIN_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    expect(screen.getByRole("heading", { name: "Start a conversation" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to /login and a member to /no-access", async () => {
    signInAs(null);
    await expectRedirect(ConversationsPage, undefined as never, "/login");
    signInAs(MEMBER_USER);
    await expectRedirect(ConversationsPage, undefined as never, "/no-access");
  });

  describe("without the write feature", () => {
    const granted = [...COMMUNITY_MANAGER_FEATURES];
    beforeEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).splice(0));
    afterEach(() => (COMMUNITY_MANAGER_FEATURES as StaffFeature[]).push(...granted));

    it("shows the list with no form and no controls", async () => {
      signInAs(CM_USER);
      await renderServerPage(ConversationsPage, undefined as never);
      expect(cards()).toHaveLength(4);
      expect(screen.queryByRole("heading", { name: "Start a conversation" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "They replied" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });
  });
});

describe("the controls", () => {
  const open = async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    return userEvent.setup();
  };

  it("logs that they replied or that she did, and reports it", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "They replied" }));
    await user.click(within(ada).getByRole("button", { name: "I replied" }));

    expect(actions.logConversationMessage).toHaveBeenNthCalledWith(1, "conv_AAAAAAAAAAA2", "member");
    expect(actions.logConversationMessage).toHaveBeenNthCalledWith(2, "conv_AAAAAAAAAAA2", "staff");
    await waitFor(() => expect(track).toHaveBeenCalledWith("conversation_message_logged", { direction: "staff" }));
    expect(track).toHaveBeenCalledWith("conversation_message_logged", { direction: "member" });
  });

  it("shows an error from the server and does not report it", async () => {
    actions.logConversationMessage.mockResolvedValue({ error: "That conversation is closed or gone." });
    const user = await open();

    await user.click(within(cards()[0]).getByRole("button", { name: "They replied" }));

    expect(await within(cards()[0]).findByRole("alert")).toHaveTextContent("That conversation is closed or gone.");
    expect(track).not.toHaveBeenCalled();
  });

  it("offers no reply buttons or close on a closed conversation", async () => {
    await open();
    const closed = cards()[3];
    expect(within(closed).queryByRole("button", { name: "They replied" })).not.toBeInTheDocument();
    expect(within(closed).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(closed).getByRole("button", { name: "Edit" })).toBeInTheDocument();
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

    expect(actions.updateConversation).toHaveBeenCalledWith("conv_AAAAAAAAAAA2", { reason: "encouragement", notes: "", nextStep: "Send a note", followUpOn: "2026-03-19" });
    await waitFor(() => expect(within(cards()[0]).queryByLabelText("Next step")).not.toBeInTheDocument());
  });

  it("closes with an outcome, asking for one first", async () => {
    const user = await open();
    const ada = cards()[0];

    await user.click(within(ada).getByRole("button", { name: "Close" }));
    await user.click(within(ada).getByRole("button", { name: "Close conversation" }));
    expect(within(ada).getByRole("alert")).toHaveTextContent("Pick how it ended.");
    expect(actions.closeConversation).not.toHaveBeenCalled();

    await user.selectOptions(within(ada).getByLabelText("How did it end?"), "re_engaged");
    await user.click(within(ada).getByRole("button", { name: "Close conversation" }));

    expect(actions.closeConversation).toHaveBeenCalledWith("conv_AAAAAAAAAAA2", "re_engaged");
    await waitFor(() => expect(track).toHaveBeenCalledWith("conversation_closed", { outcome: "re_engaged", days_open: 10 }));
  });

  it("removes a conversation only after she confirms", async () => {
    const user = await open();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await user.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(actions.deleteConversation).not.toHaveBeenCalled();
    await user.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(actions.deleteConversation).toHaveBeenCalledWith("conv_AAAAAAAAAAA2");
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

describe("starting a conversation", () => {
  const open = async () => {
    signInAs(CM_USER);
    await renderServerPage(ConversationsPage, undefined as never);
    return userEvent.setup();
  };

  it("asks for a member first, then a reason", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Start conversation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a member.");
    expect(actions.startConversation).not.toHaveBeenCalled();
  });

  it("finds a member, starts the conversation with what was filled in, and clears the form", async () => {
    const user = await open();

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.selectOptions(screen.getByLabelText("Why you are reaching out"), "welcome");
    await user.selectOptions(screen.getByLabelText("Where"), "email");
    await user.click(screen.getByLabelText("They wrote to me first"));
    await user.type(screen.getByLabelText("Note"), "Joined last week");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(actions.startConversation).toHaveBeenCalledWith({ memberId: BO, reason: "welcome", channel: "email", memberWroteFirst: true, notes: "Joined last week", followUpOn: "" });
    await waitFor(() => expect(track).toHaveBeenCalledWith("conversation_started", { reason: "welcome", channel: "email", member_wrote_first: true }));
    await waitFor(() => expect(screen.getByLabelText("Note")).toHaveValue(""));
  });

  it("keeps what was typed and says why when the server refuses", async () => {
    actions.startConversation.mockResolvedValue({ error: "There is already an open conversation with them on that channel. Log a message there instead." });
    const user = await open();

    await user.type(screen.getByRole("combobox", { name: "Member" }), "bo");
    await user.click(await screen.findByRole("option", { name: /Bo Example/ }));
    await user.selectOptions(screen.getByLabelText("Why you are reaching out"), "hello");
    await user.type(screen.getByLabelText("Note"), "Hi there");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already an open conversation");
    expect(screen.getByLabelText("Note")).toHaveValue("Hi there");
    expect(track).not.toHaveBeenCalled();
  });
});
