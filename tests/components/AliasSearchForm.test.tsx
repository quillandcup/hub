// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("AliasSearchForm ignore buttons", () => {
  it("offers a single Ignore (everywhere) outside a prickle", async () => {
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} />);

    expect(screen.queryByRole("button", { name: "Ignore here" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody()).toEqual({ zoomName: "iPhone", reason: "a phone" });
  });

  it("on a prickle, 'Ignore here' sends the prickle id without asking for a reason and hides the row", async () => {
    render(<AliasSearchForm unmatchedAttendees={unmatched} allMembers={members} prickleId={PRICKLE_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Ignore here" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(window.prompt).not.toHaveBeenCalled();
    expect(lastBody()).toEqual({ zoomName: "iPhone", reason: null, prickleId: PRICKLE_ID });
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
