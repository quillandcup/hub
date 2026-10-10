// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/lib/chat/load";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

import ChatSidebar from "@/components/chat/ChatSidebar";

const channel = (id: string, label: string, extra: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id,
  kind: "channel",
  label,
  visibility: "public",
  restricted: false,
  archived: false,
  joined: true,
  slackChannelId: null,
  ...extra,
});

const CHANNELS = [
  channel("1", "#general"),
  channel("2", "#writing-sprints"),
  channel("3", "#old-news", { archived: true }),
  channel("4", "Gale, Fern", { kind: "group_dm" }),
];

const links = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("ChatSidebar", () => {
  it("has a channel finder that is not the message search", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.getByRole("searchbox", { name: "Search messages" }).closest("form")).toHaveAttribute("action", "/chat/search");
    expect(screen.getByRole("searchbox", { name: "Find a channel" }).closest("form")).toBeNull();
  });

  it("narrows every section as you type, ignoring case and a leading #", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(links()).toHaveLength(4);

    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "#WRIT");
    expect(links()).toEqual(["#writing-sprints"]);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox", { name: "Find a channel" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "news");
    expect(links()).toEqual(["#old-news"]);
  });

  it("says so when nothing matches, and leaves the message search alone", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "zzz");
    expect(screen.getByText("No channels match.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search messages" })).toHaveValue("");
  });
});
