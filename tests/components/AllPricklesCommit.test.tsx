// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AllPricklesView from "@/app/(member)/my-prickles/AllPricklesView";
import { createCommitment } from "@/app/(member)/my-prickles/commitment-actions";
import type { PrickleInstance, PrickleScheduleRow } from "@/lib/prickle-schedule";

// Making a commitment from All Prickles: open commit mode, pick one or more weekly slots from the
// Prickle Times table (checkboxes) and/or the calendar (click a prickle), then choose weeks and a
// start date in the panel and commit them all at once.

vi.mock("@/app/(member)/my-prickles/commitment-actions", () => ({ createCommitment: vi.fn() }));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const TZ = "America/New_York";
// Saturday 2026-09-26, 11:00 AM EDT. This week is Sun 9/20 - Sat 9/26.
const NOW = new Date("2026-09-26T15:00:00Z");

function row(key: string, day: string, dayNum: number, typeId: string, typeName: string, next: string): PrickleScheduleRow {
  return {
    seriesKey: key,
    sortKey: `${dayNum}-05:00`,
    dayOfWeek: day,
    timeLabel: "5:00 AM EDT",
    typeId,
    typeName,
    nextOccurrenceId: `next-${key}`,
    nextOccurrenceStart: next,
    hostId: null,
    hostName: null,
    sessionCount: 4,
    avgAttendance: 3,
  };
}

const MON = row("t1:1-05:00", "Monday", 1, "t1", "Monday Sprint", "2026-09-28T09:00:00Z");
const WED = row("t2:3-05:00", "Wednesday", 3, "t2", "Wednesday Sprint", "2026-09-30T09:00:00Z");
const FRI = row("t3:5-05:00", "Friday", 5, "t3", "Friday Sprint", "2026-10-02T09:00:00Z");
const ROWS = [MON, WED, FRI];

function instance(id: string, seriesKey: string, typeId: string, typeName: string, startTime: string): PrickleInstance {
  const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
  return { id, seriesKey, typeId, typeName, hostId: null, hostName: null, startTime, endTime };
}

// This week's (already past) occurrences, visible in the calendar's current week.
const INSTANCES = [
  instance("mon-0921", MON.seriesKey, "t1", "Monday Sprint", "2026-09-21T09:00:00Z"),
  instance("wed-0923", WED.seriesKey, "t2", "Wednesday Sprint", "2026-09-23T09:00:00Z"),
  // A slot with no upcoming occurrence -- not on the schedule rows, so not committable.
  instance("old-0922", "t9:2-10:00", "t9", "Retired Slot", "2026-09-22T14:00:00Z"),
];

function renderView(initialCommitKeys?: string[] | null) {
  render(
    <AllPricklesView
      rows={ROWS}
      instances={INSTANCES}
      timeZone={TZ}
      upcomingWindowDays={14}
      lookbackDays={28}
      initialCommitKeys={initialCommitKeys}
    />
  );
}

const checkbox = (r: PrickleScheduleRow) =>
  screen.getByRole("checkbox", { name: `Commit to ${r.dayOfWeek} ${r.timeLabel} ${r.typeName}` });
const panel = () => screen.getByRole("form", { name: "Commit to these prickles" });
const picked = () =>
  within(screen.getByRole("list", { name: "Picked prickles" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent?.replace("×", "").trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(createCommitment).mockReset();
  push.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("All Prickles commit mode", () => {
  it("shows no checkboxes or panel until the member starts a commitment", async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Commit to these prickles" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Make a commitment/ }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(within(panel()).getByText("Nothing picked yet.")).toBeInTheDocument();
  });

  it("multi-selects slots from the table, then commits them all for the chosen number of weeks", async () => {
    vi.mocked(createCommitment).mockResolvedValue({ success: true, id: "new" });
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /Make a commitment/ }));

    // Picked out of order; the panel and the saved commitment use schedule order.
    await user.click(checkbox(FRI));
    await user.click(checkbox(MON));
    await user.click(checkbox(WED));
    expect(checkbox(MON)).toBeChecked();
    expect(picked()).toEqual([
      "Monday 5:00 AM EDT · Monday Sprint",
      "Wednesday 5:00 AM EDT · Wednesday Sprint",
      "Friday 5:00 AM EDT · Friday Sprint",
    ]);

    // Weeks default to 4; every picked session is still ahead today, so it can start today.
    const form = panel();
    expect(within(form).getByLabelText("For")).toHaveValue("4");
    expect(within(form).getByLabelText("Starting")).toHaveValue("2026-09-26");
    await user.selectOptions(within(form).getByLabelText("For"), "2");
    expect(within(form).getByText("6 sessions: Mon, Sep 28 – Fri, Oct 9 (through Fri, Oct 9)")).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Commit to these 3" }));
    expect(createCommitment).toHaveBeenCalledWith({
      slots: [
        { typeId: "t1", dayOfWeek: 1, startTimeLocal: "05:00", timezone: TZ },
        { typeId: "t2", dayOfWeek: 3, startTimeLocal: "05:00", timezone: TZ },
        { typeId: "t3", dayOfWeek: 5, startTimeLocal: "05:00", timezone: TZ },
      ],
      startDate: "2026-09-26",
      weeks: 2,
    });
    expect(await screen.findByText(/Commitment saved/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See your commitments/ })).toHaveAttribute(
      "href",
      "/my-prickles?tab=commitments"
    );
    expect(refresh).toHaveBeenCalled();
    expect(checkbox(MON)).not.toBeChecked();
  });

  it("lets the member remove a pick from the panel, which unticks its row", async () => {
    const user = userEvent.setup();
    renderView([MON.seriesKey, WED.seriesKey]);
    await user.click(screen.getByRole("button", { name: "Remove Monday 5:00 AM EDT · Monday Sprint" }));
    expect(picked()).toEqual(["Wednesday 5:00 AM EDT · Wednesday Sprint"]);
    expect(checkbox(MON)).not.toBeChecked();
    expect(within(panel()).getByRole("button", { name: "Commit to this" })).toBeInTheDocument();
  });

  it("opens in commit mode from a ?commit= deep link, ignoring keys that aren't on the schedule", () => {
    renderView([WED.seriesKey, "t9:2-10:00", "bogus"]);
    expect(picked()).toEqual(["Wednesday 5:00 AM EDT · Wednesday Sprint"]);
    expect(checkbox(WED)).toBeChecked();
  });

  it("picks a whole weekly slot by clicking a prickle in the calendar", async () => {
    const user = userEvent.setup();
    renderView([]);
    await user.click(screen.getByRole("button", { name: "Calendar" }));

    const monday = screen.getByRole("button", { name: "Monday Sprint at 5:00 AM" });
    expect(monday).toHaveAttribute("aria-pressed", "false");
    await user.click(monday);
    expect(monday).toHaveAttribute("aria-pressed", "true");
    expect(picked()).toEqual(["Monday 5:00 AM EDT · Monday Sprint"]);

    await user.click(screen.getByRole("button", { name: "Wednesday Sprint at 5:00 AM" }));
    expect(picked()).toHaveLength(2);

    // Clicking again unpicks; it never navigates away while picking.
    await user.click(monday);
    expect(picked()).toEqual(["Wednesday 5:00 AM EDT · Wednesday Sprint"]);
    expect(push).not.toHaveBeenCalled();

    // A slot with no upcoming occurrence can't be committed to.
    await user.click(screen.getByRole("button", { name: "Retired Slot at 10:00 AM" }));
    expect(picked()).toHaveLength(1);

    // Picks carry over to the table view.
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(checkbox(WED)).toBeChecked();
  });

  it("still navigates to the prickle when the calendar isn't in commit mode", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    expect(screen.queryByRole("button", { name: "Monday Sprint at 5:00 AM" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Monday Sprint", { ignore: "script, style, option" }));
    expect(push).toHaveBeenCalledWith("/prickles/mon-0921");
  });

  it("shows a server error and keeps the picks", async () => {
    vi.mocked(createCommitment).mockResolvedValue({
      error: "You're already committed to one of these prickles through 2026-10-18",
    });
    const user = userEvent.setup();
    renderView([MON.seriesKey]);
    await user.click(within(panel()).getByRole("button", { name: "Commit to this" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already committed");
    expect(picked()).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closing the panel leaves commit mode and clears the picks", async () => {
    const user = userEvent.setup();
    renderView([MON.seriesKey]);
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Make a commitment/ }));
    expect(within(panel()).getByText("Nothing picked yet.")).toBeInTheDocument();
  });
});
