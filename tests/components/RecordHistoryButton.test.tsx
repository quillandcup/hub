// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const loadRecordHistory = vi.fn();
vi.mock("@/app/actions/record-history", () => ({ loadRecordHistory: (...a: unknown[]) => loadRecordHistory(...a) }));

import RecordHistoryButton from "@/components/RecordHistoryButton";

const row = {
  event_id: "audit:1",
  kind: "audit",
  occurred_at: "2026-10-01T12:00:00Z",
  is_audit: true,
  actor_user_id: "u1",
  actor_kind: "staff",
  actor_label: "Bramble Admin",
  member_id: null,
  member_name: null,
  acting_as_member_id: null,
  acting_as_member_name: null,
  event_type: "update",
  entity_type: "badge_type",
  entity_id: "b1",
  title: null,
  description: "Early Bird",
  source: "audit_log",
  data: { name: { old: "Early", new: "Early Bird" } },
};

beforeEach(() => loadRecordHistory.mockReset());

describe("RecordHistoryButton", () => {
  it("loads the record's history on open and shows who changed what", async () => {
    loadRecordHistory.mockResolvedValue({ rows: [row] });
    render(<RecordHistoryButton entityType="badge_type" entityId="b1" label="Early Bird" />);
    expect(loadRecordHistory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Change history of Early Bird" }));
    expect(loadRecordHistory).toHaveBeenCalledWith("badge_type", "b1");
    expect(await screen.findByText(/Bramble Admin/)).toBeInTheDocument();
    expect(screen.getByText(/changed badge type “Early Bird”/)).toBeInTheDocument();
    expect(screen.getByText("Early")).toBeInTheDocument();
  });

  it("says so when nothing was recorded, and shows load errors", async () => {
    loadRecordHistory.mockResolvedValueOnce({ rows: [] });
    render(<RecordHistoryButton entityType="event" entityId="e1" />);
    await userEvent.click(screen.getByRole("button", { name: /Change history/ }));
    expect(await screen.findByText("No changes recorded.")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Close"));
    loadRecordHistory.mockResolvedValueOnce({ error: "Couldn't load the history." });
    await userEvent.click(screen.getByRole("button", { name: /Change history/ }));
    expect(await screen.findByText("Couldn't load the history.")).toBeInTheDocument();
  });
});
