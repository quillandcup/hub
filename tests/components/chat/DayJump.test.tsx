// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

import DayJump from "@/components/chat/DayJump";

const CHANNEL = "chn_AAAAAAAAAAA1";
const NY = "America/New_York";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z")); // Friday the 13th, 10 AM in New York
  push.mockClear();
  track.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = () => {
  render(<DayJump channelId={CHANNEL} label="Wednesday, November 11th" timeZone={NY} />);
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
};
const open = async (user: ReturnType<typeof setup>) => user.click(screen.getByRole("button", { name: /Jump to/ }));
const from = (iso: string) => `/chat/${CHANNEL}?from=${encodeURIComponent(iso)}`;

describe("DayJump", () => {
  it("shows the day's label on a button, and lists the choices when it is pressed", async () => {
    const user = setup();
    expect(screen.getByRole("button", { name: /Wednesday, November 11th/ })).toHaveAttribute("aria-haspopup", "menu");
    await open(user);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Jump to...")).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Today",
      "Yesterday",
      "Last week",
      "Last month",
      "The very beginning",
      "Jump to a specific date",
    ]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  it.each([
    ["Today", "2026-11-13T05:00:00.000Z", "today"],
    ["Yesterday", "2026-11-12T05:00:00.000Z", "yesterday"],
    ["Last week", "2026-11-06T05:00:00.000Z", "last_week"],
    ["Last month", "2026-10-13T04:00:00.000Z", "last_month"],
    ["The very beginning", "1970-01-01T00:00:00.000Z", "beginning"],
  ])("%s opens the conversation at the start of that day", async (name, iso, option) => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name }));

    expect(push).toHaveBeenCalledWith(from(iso));
    expect(track).toHaveBeenCalledWith("chat_jumped", { option });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves through the choices with the arrow keys and closes on Escape", async () => {
    const user = setup();
    await open(user);
    expect(screen.getByRole("menuitem", { name: "Today" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Yesterday" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a calendar for a specific date, with today marked", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Jump to a specific date" }));

    const dialog = screen.getByRole("dialog", { name: "Jump to a specific date" });
    // Out of the sticky day label's stacking layer, so nothing later in the list can paint over it.
    expect(screen.getByRole("button", { name: /Jump to/ }).closest("div")!.contains(dialog)).toBe(false);
    expect(within(dialog).getByText("November 2026")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "November 13, 2026" })).toHaveAttribute("aria-current", "date");
    expect(push).not.toHaveBeenCalled();
  });

  it("jumps to the start of the chosen day and closes the calendar", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Jump to a specific date" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    await user.click(within(dialog).getByRole("button", { name: "October 31, 2026" }));

    // October 31st is still daylight saving time in New York.
    expect(push).toHaveBeenCalledWith(from("2026-10-31T04:00:00.000Z"));
    expect(track).toHaveBeenCalledWith("chat_jumped", { option: "date" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the calendar with its X or Escape without jumping", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Jump to a specific date" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Jump to a specific date" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
