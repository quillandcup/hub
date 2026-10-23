// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const actions = vi.hoisted(() => ({
  addChatMembers: vi.fn(),
  joinChatChannel: vi.fn(),
  removeChatMember: vi.fn(),
  searchMembersToAdd: vi.fn(),
}));
vi.mock("@/app/(member)/chat/membership-actions", () => actions);

import MembersManager from "@/components/chat/MembersManager";
import JoinPrompt from "@/components/chat/JoinPrompt";
import type { MembershipAbilities } from "@/lib/chat/membership-abilities";

const NONE: MembershipAbilities = { blocked: null, canJoin: false, canLeave: false, canAdd: false, canRemoveOthers: false };
const people = [
  { memberId: "m-fern", name: "Fern Quillsby", photoUrl: null },
  { memberId: "m-gale", name: "Gale Prickleton", photoUrl: null },
];
const GALE_RESULT = { memberId: "m-gale", name: "Gale Prickleton", photoUrl: null, inSlack: true };

const setup = (abilities: Partial<MembershipAbilities>, props: { isPrivate?: boolean } = {}) =>
  render(
    <MembersManager
      channelId="c1"
      channelLabel="#hosts"
      isPrivate={props.isPrivate ?? false}
      people={people}
      viewerId="m-fern"
      abilities={{ ...NONE, ...abilities }}
    />
  );

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.searchMembersToAdd.mockResolvedValue([]);
  actions.addChatMembers.mockResolvedValue({ ok: true });
  actions.joinChatChannel.mockResolvedValue({ ok: true });
  actions.removeChatMember.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MembersManager", () => {
  it("lists people, each linking to their profile, and shows no controls when there are none", () => {
    setup({});
    expect(screen.getByRole("link", { name: /Gale Prickleton/ })).toHaveAttribute("href", "/members/m-gale");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Add people" })).not.toBeInTheDocument();
  });

  it("says why nothing can be changed", () => {
    setup({ blocked: "This conversation is archived." });
    expect(screen.getByText("This conversation is archived.")).toBeInTheDocument();
  });

  it("says so when there is no one", () => {
    render(<MembersManager channelId="c1" channelLabel="#hosts" isPrivate={false} people={[]} viewerId="m-fern" abilities={NONE} />);
    expect(screen.getByText("No members to show.")).toBeInTheDocument();
  });

  it("joins, then refreshes", async () => {
    actions.joinChatChannel.mockResolvedValue({ ok: true, message: "Added." });
    setup({ canJoin: true });
    await userEvent.click(screen.getByRole("button", { name: "Join #hosts" }));
    expect(actions.joinChatChannel).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("status")).toHaveTextContent("Added.");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows what went wrong, and doesn't refresh", async () => {
    actions.joinChatChannel.mockResolvedValue({ ok: false, error: "Billie Bot isn't in this conversation." });
    setup({ canJoin: true });
    await userEvent.click(screen.getByRole("button", { name: "Join #hosts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Billie Bot isn't in this conversation.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a generic error when the action throws", async () => {
    actions.joinChatChannel.mockRejectedValue(new Error("network"));
    setup({ canJoin: true });
    await userEvent.click(screen.getByRole("button", { name: "Join #hosts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("asks before leaving, can be backed out of, and goes to the chat list after leaving", async () => {
    setup({ canLeave: true });
    await userEvent.click(screen.getByRole("button", { name: "Leave #hosts" }));
    expect(screen.getByText(/removed from it in Slack too/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(actions.removeChatMember).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Leave #hosts" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(actions.removeChatMember).toHaveBeenCalledWith("c1", "m-fern");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat"));
  });

  it("lets staff remove someone else after confirming, but never offers it for themselves", async () => {
    setup({ canRemoveOthers: true });
    expect(screen.queryByRole("button", { name: "Remove Fern Quillsby" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Gale Prickleton" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(actions.removeChatMember).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Remove Gale Prickleton" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm removing Gale Prickleton" }));
    expect(actions.removeChatMember).toHaveBeenCalledWith("c1", "m-gale");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  describe("adding people", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    const type = async (text: string) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByRole("searchbox", { name: "Add people" }), text);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      return user;
    };

    it("searches once typing settles, not for a single letter, and adds on a click", async () => {
      actions.searchMembersToAdd.mockResolvedValue([GALE_RESULT]);
      setup({ canAdd: true });

      await type("g");
      expect(actions.searchMembersToAdd).not.toHaveBeenCalled();

      const user = await type("ale");
      expect(actions.searchMembersToAdd).toHaveBeenCalledTimes(1);
      expect(actions.searchMembersToAdd).toHaveBeenCalledWith("c1", "gale");

      await user.click(await screen.findByRole("button", { name: "Add Gale Prickleton" }));
      expect(actions.addChatMembers).toHaveBeenCalledWith("c1", ["m-gale"]);
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(screen.getByRole("searchbox", { name: "Add people" })).toHaveValue("");
      expect(screen.queryByRole("list", { name: "People to add" })).not.toBeInTheDocument();
    });

    it("says when no one matches", async () => {
      setup({ canAdd: true });
      await type("zzz");
      expect(await screen.findByText("No one to add matches that.")).toBeInTheDocument();
    });

    it("ignores a search that fails", async () => {
      actions.searchMembersToAdd.mockRejectedValue(new Error("x"));
      setup({ canAdd: true });
      await type("gale");
      expect(await screen.findByText("No one to add matches that.")).toBeInTheDocument();
    });

    it("drops an answer to something typed since", async () => {
      let resolveFirst: (v: unknown) => void = () => {};
      actions.searchMembersToAdd
        .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
        .mockResolvedValue([]);
      setup({ canAdd: true });
      await type("ga");
      await type("le");
      await act(async () => resolveFirst([GALE_RESULT]));
      expect(screen.queryByRole("button", { name: "Add Gale Prickleton" })).not.toBeInTheDocument();
    });

    it("says someone not in Slack is only in the Hub for a public channel, and can't be added to a private one", async () => {
      actions.searchMembersToAdd.mockResolvedValue([{ ...GALE_RESULT, inSlack: false }]);
      setup({ canAdd: true });
      await type("gale");
      expect(await screen.findByText(/only in the Hub/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Gale Prickleton" })).toBeEnabled();
      cleanup();

      setup({ canAdd: true }, { isPrivate: true });
      await type("gale");
      expect(await screen.findByText(/can't join a private conversation/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Gale Prickleton" })).toBeDisabled();
    });
  });
});

describe("JoinPrompt", () => {
  it("offers to join, then refreshes so the message box appears", async () => {
    render(<JoinPrompt channelId="c1" channelLabel="#general" />);
    expect(screen.getByText(/You're not in #general/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Join #general" }));
    expect(actions.joinChatChannel).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows why it didn't work", async () => {
    actions.joinChatChannel.mockResolvedValue({ ok: false, error: "Nope." });
    render(<JoinPrompt channelId="c1" channelLabel="#general" />);
    await userEvent.click(screen.getByRole("button", { name: "Join #general" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the action throws", async () => {
    actions.joinChatChannel.mockRejectedValue(new Error("x"));
    render(<JoinPrompt channelId="c1" channelLabel="#general" />);
    await userEvent.click(screen.getByRole("button", { name: "Join #general" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
