// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const addPrickle = vi.fn();
const addEvent = vi.fn();
const removeItem = vi.fn();
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  addPrickleToMyCalendar: (...args: unknown[]) => addPrickle(...args),
  addEventToMyCalendar: (...args: unknown[]) => addEvent(...args),
  removeMyCalendarItem: (...args: unknown[]) => removeItem(...args),
}));

import { AddEventToCalendar, AddPrickleToCalendar } from "@/app/(member)/my-prickles/AddToCalendar";
import type { PrickleCalendarState } from "@/lib/calendar-feed";

const NONE: PrickleCalendarState = { onceItemId: null, weeklyItemId: null };

beforeEach(() => {
  for (const fn of [addPrickle, addEvent, removeItem]) fn.mockReset();
  addPrickle.mockResolvedValue({ ok: true });
  addEvent.mockResolvedValue({ ok: true });
  removeItem.mockResolvedValue({ ok: true });
});

function renderPrickle(state: PrickleCalendarState = NONE, extra: Partial<Parameters<typeof AddPrickleToCalendar>[0]> = {}) {
  render(
    <AddPrickleToCalendar prickleId="p1" typeName="Educational Prickle" nextLabel="Tue, Oct 6" state={state} {...extra} />
  );
}

describe("AddPrickleToCalendar", () => {
  it("adds just the next one", async () => {
    const user = userEvent.setup();
    renderPrickle();
    await user.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Just this one · Tue, Oct 6/ }));
    expect(addPrickle).toHaveBeenCalledWith("p1", "once");
  });

  it("checks the box and turns the icon on before the server answers", async () => {
    const user = userEvent.setup();
    // Held open until the end: React waits on every pending action before finishing any transition.
    let answer!: (value: { ok: true }) => void;
    addPrickle.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderPrickle(NONE, { variant: "icon" });
    await user.click(screen.getByRole("button", { name: "Add Educational Prickle to your calendar" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Every week" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Every week" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Educational Prickle is in your calendar" })).toBeInTheDocument();
    await act(async () => answer({ ok: true }));
  });

  it("adds every week", async () => {
    const user = userEvent.setup();
    renderPrickle();
    await user.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Every week" }));
    expect(addPrickle).toHaveBeenCalledWith("p1", "weekly");
  });

  it("shows what's added and removes it on a second click", async () => {
    const user = userEvent.setup();
    renderPrickle({ onceItemId: "item-1", weeklyItemId: null });
    await user.click(screen.getByRole("button", { name: /In my calendar/ }));
    const once = screen.getByRole("menuitemcheckbox", { name: /Just this one/ });
    expect(once).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Every week" })).toHaveAttribute("aria-checked", "false");
    await user.click(once);
    expect(removeItem).toHaveBeenCalledWith("item-1");
    expect(addPrickle).not.toHaveBeenCalled();
  });

  it("treats \"just this one\" as included (and locked) while every week is on", async () => {
    const user = userEvent.setup();
    renderPrickle({ onceItemId: null, weeklyItemId: "item-2" });
    await user.click(screen.getByRole("button", { name: /In my calendar/ }));
    const once = screen.getByRole("menuitemcheckbox", { name: /Just this one/ });
    expect(once).toHaveAttribute("aria-checked", "true");
    expect(once).toBeDisabled();
  });

  it("shows an error from the action and unchecks the box again", async () => {
    const user = userEvent.setup();
    addPrickle.mockResolvedValue({ error: "Couldn't add that to your calendar. Please try again." });
    renderPrickle();
    await user.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Every week" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add that");
    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: "Every week" })).toHaveAttribute("aria-checked", "false")
    );
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    renderPrickle();
    await user.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows prickles the member hosts as already included, with nothing to click", () => {
    renderPrickle(NONE, { autoIncluded: "hosting" });
    expect(screen.getByText("In your calendar: you're hosting")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has an icon-only variant for table rows, labelled for screen readers", async () => {
    const user = userEvent.setup();
    renderPrickle(NONE, { variant: "icon" });
    await user.click(screen.getByRole("button", { name: "Add Educational Prickle to your calendar" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("AddEventToCalendar", () => {
  it("adds an event", async () => {
    const user = userEvent.setup();
    render(<AddEventToCalendar eventId="e1" itemId={null} />);
    await user.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    expect(addEvent).toHaveBeenCalledWith("e1");
  });

  it("removes an event that's already added", async () => {
    const user = userEvent.setup();
    render(<AddEventToCalendar eventId="e1" itemId="item-9" />);
    const button = screen.getByRole("button", { name: /In my calendar · Remove/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(removeItem).toHaveBeenCalledWith("item-9");
  });
});
