// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MyCalendarItem } from "@/lib/calendar-feed";

const removeItem = vi.fn();
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  removeMyCalendarItem: (id: string) => removeItem(id),
}));

import AddedToCalendarList from "@/app/(member)/my-prickles/AddedToCalendarList";

const ITEMS: MyCalendarItem[] = [
  { id: "i1", kind: "slot", label: "Educational Prickle · every Tuesday · 7:00 PM EDT", slotKey: "k" },
  { id: "i2", kind: "event", label: "Fall Retreat · Oct 9 – Oct 11", eventId: "e1" },
];

beforeEach(() => {
  removeItem.mockReset();
});

describe("AddedToCalendarList", () => {
  it("renders nothing when the member hasn't added anything", () => {
    const { container } = render(<AddedToCalendarList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists added items and removes one right away", async () => {
    const user = userEvent.setup();
    // Held open until the end: React waits on every pending action before finishing any transition.
    let answer!: (value: { ok: true }) => void;
    removeItem.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<AddedToCalendarList items={ITEMS} />);

    expect(screen.getByRole("heading", { name: "Also added to your calendar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Fall Retreat · Oct 9 – Oct 11 from your calendar" }));
    expect(removeItem).toHaveBeenCalledWith("i2");
    expect(screen.queryByText("Fall Retreat · Oct 9 – Oct 11")).not.toBeInTheDocument();
    expect(screen.getByText("Educational Prickle · every Tuesday · 7:00 PM EDT")).toBeInTheDocument();
    await act(async () => answer({ ok: true }));
  });

  it("puts the item back and shows the error if removing fails", async () => {
    const user = userEvent.setup();
    removeItem.mockResolvedValue({ error: "Couldn't remove that. Please try again." });
    render(<AddedToCalendarList items={ITEMS} />);

    await user.click(screen.getByRole("button", { name: "Remove Fall Retreat · Oct 9 – Oct 11 from your calendar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove that");
    expect(await screen.findByText("Fall Retreat · Oct 9 – Oct 11")).toBeInTheDocument();
  });
});
