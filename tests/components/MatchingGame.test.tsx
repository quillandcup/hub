// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import MatchingGame from "@/app/(admin)/admin/hygiene/name-matching/MatchingGame";

const ada = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: null, email: "ada@example.com" };
const attendees = [{ zoomName: "Ada's iPad", appearances: 1, emails: [] }];

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1 }) }) as any;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MatchingGame save", () => {
  it("clears the saved matches after 2 s with a single timer, and leaves none behind on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<MatchingGame unmatchedAttendees={attendees} membersWithNoAttendance={[ada]} />);

    const match = () => {
      fireEvent.dragStart(screen.getByText("Ada's iPad"));
      fireEvent.drop(screen.getByText("Ada Example"));
    };
    const save = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save Aliases" })));

    match();
    await save();
    expect(screen.getByText("✓ Saved 1 aliases!")).toBeInTheDocument();
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0);

    await save(); // a second save replaces the pending clear rather than adding another
    expect(vi.getTimerCount()).toBe(pending);
    act(() => void vi.advanceTimersByTime(1999));
    expect(screen.getByText("✓ Saved 1 aliases!")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText("✓ Saved 1 aliases!")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Aliases" })).not.toBeInTheDocument();

    match();
    await save();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
