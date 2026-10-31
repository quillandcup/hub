// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AliasSearchForm from "@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm";

const PRICKLE_ID = "prkl_AAAAAAAAAAA1";
const unmatched = [{ zoomName: "iPhone", appearances: 1, emails: [] }];
const members = [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" }];

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as any;
  vi.spyOn(window, "prompt").mockReturnValue("a phone");
});

function lastBody() {
  const call = vi.mocked(global.fetch).mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("AliasSearchForm save", () => {
  const lookalike = [{ zoomName: "Ada Exampl", appearances: 1, emails: [] }];

  it("clears the saved matches after 2 s with a single timer, and leaves none behind on unmount", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1 }) }) as any;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<AliasSearchForm unmatchedAttendees={lookalike} allMembers={members} />);
      fireEvent.click(screen.getByRole("button", { name: "Ada Example" }));
      const save = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save Aliases" })));
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

      fireEvent.click(screen.getByRole("button", { name: "Ada Example" }));
      await save();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      cleanup();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AliasSearchForm ignore buttons", () => {
  it("offers a single Ignore (everywhere) outside a prickle", async () => {
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} />);

    expect(screen.queryByRole("button", { name: "Ignore here" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody()).toEqual({ zoomName: "iPhone", reason: "a phone" });
  });

  it("on a prickle, 'Ignore here' asks for a reason, sends it with the prickle id and hides the row", async () => {
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} prickleId={PRICKLE_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Ignore here" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining("on this prickle"));
    expect(lastBody()).toEqual({ zoomName: "iPhone", reason: "a phone", prickleId: PRICKLE_ID });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ignore here" })).not.toBeInTheDocument());
  });

  it("on a prickle, 'Ignore always' ignores the name for every prickle", async () => {
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} prickleId={PRICKLE_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Ignore always" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(window.prompt).toHaveBeenCalled();
    expect(lastBody()).toEqual({ zoomName: "iPhone", reason: "a phone" });
  });

  it("does nothing when the reason prompt is cancelled", async () => {
    vi.mocked(window.prompt).mockReturnValue(null);
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} prickleId={PRICKLE_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Ignore always" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
