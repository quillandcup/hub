// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveRoomIndicator from "@/components/LiveRoomIndicator";
import type { LiveRoom } from "@/lib/live-room";

const join = { url: "https://zoom.example/j/1", meetingId: "123", passcode: "pw" };

function mockRoom(room: LiveRoom) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => room })));
}

afterEach(() => vi.unstubAllGlobals());

describe("LiveRoomIndicator", () => {
  it("shows On air with the count, and who is there on click", async () => {
    mockRoom({
      live: true,
      count: 3,
      members: [
        { memberId: "m1", name: "Alice" },
        { memberId: "m2", name: "Bea" },
      ],
      guests: 1,
      prickle: { id: "p1", title: "Morning Writing", hostName: "Alice" },
      join,
    });
    render(<LiveRoomIndicator />);
    await userEvent.click(await screen.findByRole("button", { name: /on air/i }));

    expect(screen.getAllByText("3 Hedgies at the table").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Morning Writing" })).toHaveAttribute("href", "/prickles/p1");
    expect(screen.getByText("Hosted by Alice")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bea" })).toHaveAttribute("href", "/members/m2");
    expect(screen.getByText("1 guest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join on Zoom" })).toHaveAttribute("href", join.url);
  });

  it("shows Off air with a link to start a PUP when the room is empty", async () => {
    mockRoom({ live: false, count: 0, members: [], guests: 0, prickle: null, join });
    render(<LiveRoomIndicator />);
    await userEvent.click(await screen.findByRole("button", { name: /off air/i }));

    expect(screen.getByText("Nobody is at the table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a PUP on Zoom" })).toHaveAttribute("href", join.url);
  });

  it("renders nothing until the first answer arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    render(<LiveRoomIndicator />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("closes on Escape, on a click outside, and when a link inside is followed", async () => {
    mockRoom({
      live: true,
      count: 1,
      members: [{ memberId: "m1", name: "Alice" }],
      guests: 0,
      prickle: { id: "p1", title: "Morning Writing", hostName: null },
      join: null,
    });
    render(<LiveRoomIndicator />);
    const open = async () => userEvent.click(await screen.findByRole("button", { name: /on air/i }));

    await open();
    expect(screen.getByText("1 Hedgie at the table", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("No Zoom link is set up yet.")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(screen.getByRole("link", { name: "Alice" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(screen.getByRole("link", { name: "Morning Writing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
