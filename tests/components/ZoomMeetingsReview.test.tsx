// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/hygiene/zoom-meetings",
  useSearchParams: () => new URLSearchParams(),
}));
const decide = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/app/(admin)/admin/hygiene/zoom-meetings/actions", () => ({ decideZoomMeetings: decide.fn }));

import ZoomMeetingsReview, { type ReviewRow } from "@/app/(admin)/admin/hygiene/zoom-meetings/ZoomMeetingsReview";

const accounts = [
  { id: "zacc_SecondAcct01", label: "Second account" },
  { id: "zacc_ThirdAcct001", label: "Third account" },
];
const row = (n: number, extra: Partial<ReviewRow> = {}): ReviewRow => ({
  zoomAccount: "zacc_SecondAcct01",
  accountLabel: "Second account",
  meetingUuid: `uuid-${n}`,
  meetingId: `mid-${n}`,
  topic: `Meeting ${n}`,
  startTime: `2026-10-0${n}T15:00:00Z`,
  participantCount: n,
  state: "undecided",
  ...extra,
});
const rows: ReviewRow[] = [
  row(1),
  row(2, { state: "kept" }),
  row(3, { state: "ignored", topic: "Dentist" }),
  row(4, { zoomAccount: "zacc_ThirdAcct001", accountLabel: "Third account", meetingId: "mid-1" }),
];

const shown = () => screen.getAllByRole("row").slice(1).map((r) => within(r).queryAllByRole("cell")[1]?.textContent ?? "");

beforeEach(() => {
  decide.fn.mockReset().mockResolvedValue({ success: true, decided: 1 });
  refresh.mockClear();
});

describe("ZoomMeetingsReview", () => {
  it("starts on the undecided meetings and filters by state, account, date and search", async () => {
    const user = userEvent.setup();
    render(<ZoomMeetingsReview rows={rows} accounts={accounts} timeZone="America/New_York" />);

    expect(shown()).toEqual([expect.stringContaining("Meeting 4"), expect.stringContaining("Meeting 1")]);

    await user.selectOptions(screen.getByLabelText("State"), "all");
    expect(shown()).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText("State"), "ignored");
    expect(shown()).toEqual([expect.stringContaining("Dentist")]);

    await user.selectOptions(screen.getByLabelText("State"), "all");
    await user.selectOptions(screen.getByLabelText("Account"), "zacc_ThirdAcct001");
    expect(shown()).toEqual([expect.stringContaining("Meeting 4")]);

    await user.selectOptions(screen.getByLabelText("Account"), "all");
    await user.type(screen.getByLabelText("From"), "2026-10-03");
    expect(shown()).toEqual([expect.stringContaining("Meeting 4"), expect.stringContaining("Dentist")]);
    await user.type(screen.getByLabelText("To"), "2026-10-03");
    expect(shown()).toEqual([expect.stringContaining("Dentist")]);
  });

  it("searches the topic and the Zoom meeting id", async () => {
    const user = userEvent.setup();
    render(<ZoomMeetingsReview rows={rows} accounts={accounts} timeZone="America/New_York" />);
    await user.selectOptions(screen.getByLabelText("State"), "all");

    await user.type(screen.getByLabelText("Search topic or meeting ID"), "dentist");
    expect(shown()).toEqual([expect.stringContaining("Dentist")]);

    await user.clear(screen.getByLabelText("Search topic or meeting ID"));
    await user.type(screen.getByLabelText("Search topic or meeting ID"), "mid-1");
    expect(shown()).toHaveLength(2);
  });

  it("keeps the selected meetings and refreshes", async () => {
    const user = userEvent.setup();
    render(<ZoomMeetingsReview rows={rows} accounts={accounts} timeZone="America/New_York" />);

    await user.click(screen.getByLabelText("Select Meeting 1"));
    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(decide.fn).toHaveBeenCalledWith({ choice: "kept", scope: "instance", targets: [{ zoomAccount: "zacc_SecondAcct01", zoomKey: "uuid-1" }] });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 1");
    expect(refresh).toHaveBeenCalled();
  });

  it("ignores, or takes back, several at once with the header checkbox", async () => {
    const user = userEvent.setup();
    render(<ZoomMeetingsReview rows={rows} accounts={accounts} timeZone="America/New_York" />);

    await user.click(screen.getByLabelText("Select all meetings on this page"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(decide.fn).toHaveBeenLastCalledWith({
      choice: "ignored",
      scope: "instance",
      targets: [
        { zoomAccount: "zacc_ThirdAcct001", zoomKey: "uuid-4" },
        { zoomAccount: "zacc_SecondAcct01", zoomKey: "uuid-1" },
      ],
    });

    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Select Meeting 1"));
    await user.click(screen.getByRole("button", { name: "Back to default" }));
    expect(decide.fn).toHaveBeenLastCalledWith({ choice: "undecided", scope: "instance", targets: [{ zoomAccount: "zacc_SecondAcct01", zoomKey: "uuid-1" }] });
  });

  it("decides every occurrence of a link once per link and account, even with several meetings selected", async () => {
    const user = userEvent.setup();
    const sameLink = [row(1), row(5, { meetingId: "mid-1" }), row(6, { meetingId: "mid-6" })];
    render(<ZoomMeetingsReview rows={sameLink} accounts={accounts} timeZone="America/New_York" />);

    await user.click(screen.getByLabelText("Select all meetings on this page"));
    await user.click(screen.getByRole("button", { name: "Keep every occurrence of these links" }));

    expect(decide.fn).toHaveBeenCalledWith({
      choice: "kept",
      scope: "series",
      targets: [
        // newest first, as the table lists them
        { zoomAccount: "zacc_SecondAcct01", zoomKey: "mid-6" },
        { zoomAccount: "zacc_SecondAcct01", zoomKey: "mid-1" },
      ],
    });
  });

  it("says so when the save fails or attendance could not be rebuilt, and disables the buttons with nothing selected", async () => {
    const user = userEvent.setup();
    render(<ZoomMeetingsReview rows={rows} accounts={accounts} timeZone="America/New_York" />);
    expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();

    decide.fn.mockResolvedValueOnce({ error: "Not authorized" });
    await user.click(screen.getByLabelText("Select Meeting 1"));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
    expect(refresh).not.toHaveBeenCalled();

    decide.fn.mockResolvedValueOnce({ success: true, decided: 1, reprocessError: "processing down" });
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(await screen.findByRole("status")).toHaveTextContent("rebuilding attendance failed (processing down)");
  });

  it("shows an empty state", () => {
    render(<ZoomMeetingsReview rows={[]} accounts={[]} timeZone="America/New_York" />);

    expect(screen.getByText("No meetings match.")).toBeInTheDocument();
  });
});
