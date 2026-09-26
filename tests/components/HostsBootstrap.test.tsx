// @vitest-environment jsdom
/**
 * Admin Hosts "Bootstrap <Month> from calendar": a dry-run preview, a confirm() showing its counts,
 * then the real import -- with an optional second confirm() to also confirm matching proposed rows.
 * fetch is routed by URL (the component also loads schedules and locks on mount) and confirm() is a
 * vi.fn so no real dialog ever opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostsClient from "@/app/(admin)/admin/hosts/HostsClient";
import { getMonthStart, getNextMonthStart } from "@/lib/prickle-schedules";

const CURRENT_MONTH = getMonthStart(new Date()).toISOString().slice(0, 10);
const NEXT_MONTH = getNextMonthStart(new Date()).toISOString().slice(0, 10);
const label = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}T00:00:00Z`)
  );

interface Preview {
  created: number;
  skippedExisting: number;
  unmatchedExisting: number;
  matchingProposed: number;
}

const PREVIEW: Preview = { created: 3, skippedExisting: 2, unmatchedExisting: 1, matchingProposed: 0 };

const NEW_MEMBER_SCHEDULE = {
  id: "sched-1",
  host_id: "member-hazel",
  type_id: "type-progress",
  month: CURRENT_MONTH,
  recurrence_type: "weekly",
  day_of_week: 2,
  recurrence_anchor_date: null,
  week_of_month: null,
  event_date: null,
  start_time_local: "10:00",
  timezone: "America/New_York",
  status: "proposed",
  notes: null,
  carried_forward_from: null,
  member: { id: "member-hazel", name: "Hazel Burrowes", email: "hazel.burrowes@example.test" },
  prickle_type: { id: "type-progress", name: "Progress Prickle" },
  host_eligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
};

let preview: Preview;
let bootstrapBodies: Record<string, unknown>[];
let confirmMock: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let previewFails: boolean;

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
}

beforeEach(() => {
  preview = { ...PREVIEW };
  bootstrapBodies = [];
  previewFails = false;
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/prickle-schedules/bootstrap") {
      const body = JSON.parse(String(init?.body));
      bootstrapBodies.push(body);
      if (body.dryRun) {
        return previewFails ? jsonResponse({ error: "Calendar unavailable" }, false) : jsonResponse(preview);
      }
      return jsonResponse({
        created: preview.created,
        skippedExisting: preview.skippedExisting,
        confirmedExisting: body.confirmMatchingProposed ? preview.matchingProposed : 0,
        copiedToNextMonth: 3,
      });
    }
    if (url.startsWith("/api/prickle-schedules?month=")) {
      const month = new URL(url, "http://localhost").searchParams.get("month");
      return jsonResponse({ schedules: month === CURRENT_MONTH ? [NEW_MEMBER_SCHEDULE] : [] });
    }
    if (url === "/api/prickle-schedule-locks") return jsonResponse({ locks: [] });
    return jsonResponse({ error: `unexpected fetch ${url}` }, false);
  });
  vi.stubGlobal("fetch", fetchMock);
  confirmMock = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLoaded() {
  render(<HostsClient prickleTypes={[{ id: "type-progress", name: "Progress Prickle" }]} />);
  await screen.findByText("Hazel Burrowes");
}

function bootstrapButton(month: string) {
  return screen.getByRole("button", { name: `Bootstrap ${label(month)} from calendar` });
}

describe("HostsClient bootstrap from calendar", () => {
  it("shows the bootstrap button for the selected month on both the Current and Next Month tabs", async () => {
    await renderLoaded();
    expect(bootstrapButton(CURRENT_MONTH)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Next Month/ }));
    expect(bootstrapButton(NEXT_MONTH)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Bootstrap ${label(CURRENT_MONTH)} from calendar` })).toBeNull();
  });

  it("previews with a dry run, confirms with the counts, then imports without dryRun", async () => {
    await renderLoaded();
    await userEvent.click(bootstrapButton(CURRENT_MONTH));

    await screen.findByText(/Bootstrapped 3 schedules from the calendar/);
    expect(bootstrapBodies).toEqual([
      { month: CURRENT_MONTH, dryRun: true },
      { month: CURRENT_MONTH, confirmMatchingProposed: false },
    ]);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = String(confirmMock.mock.calls[0][0]);
    expect(message).toContain(`Import ${label(CURRENT_MONTH)} hosting schedules from the calendar?`);
    expect(message).toContain("3 new confirmed schedules");
    expect(message).toContain("2 already here");
    expect(message).toContain("1 existing schedule not on the calendar");
    expect(screen.getByText(/skipped 2 already there, copied 3 to next month\./)).toBeInTheDocument();
  });

  it("sends nothing further when the admin cancels the preview confirm", async () => {
    confirmMock.mockReturnValueOnce(false);
    await renderLoaded();
    await userEvent.click(bootstrapButton(CURRENT_MONTH));

    await waitFor(() => expect(bootstrapButton(CURRENT_MONTH)).toBeEnabled());
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(bootstrapBodies).toEqual([{ month: CURRENT_MONTH, dryRun: true }]);
    expect(screen.queryByText(/Bootstrapped/)).toBeNull();
  });

  it("asks a second question when proposed rows match, and sends confirmMatchingProposed only when accepted", async () => {
    preview.matchingProposed = 2;
    await renderLoaded();
    await userEvent.click(bootstrapButton(CURRENT_MONTH));

    await screen.findByText(/confirmed 2 proposed/);
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(String(confirmMock.mock.calls[1][0])).toBe(
      "2 existing proposed schedules match the calendar. Mark them confirmed too?"
    );
    expect(bootstrapBodies[1]).toEqual({ month: CURRENT_MONTH, confirmMatchingProposed: true });
  });

  it("still imports, without confirming proposed rows, when the second question is declined", async () => {
    preview.matchingProposed = 1;
    confirmMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await renderLoaded();
    await userEvent.click(bootstrapButton(CURRENT_MONTH));

    await screen.findByText(/Bootstrapped 3 schedules/);
    expect(String(confirmMock.mock.calls[1][0])).toBe(
      "1 existing proposed schedule matches the calendar. Mark it confirmed too?"
    );
    expect(bootstrapBodies[1]).toEqual({ month: CURRENT_MONTH, confirmMatchingProposed: false });
  });

  it("bootstraps the next month from the Next Month tab", async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole("tab", { name: /Next Month/ }));
    await screen.findByText("No schedules for this month yet.");
    await userEvent.click(bootstrapButton(NEXT_MONTH));

    await screen.findByText(/Bootstrapped 3 schedules/);
    expect(bootstrapBodies).toEqual([
      { month: NEXT_MONTH, dryRun: true },
      { month: NEXT_MONTH, confirmMatchingProposed: false },
    ]);
    expect(String(confirmMock.mock.calls[0][0])).toContain(`Import ${label(NEXT_MONTH)} hosting schedules`);
  });

  it("shows the preview error and never asks to confirm when the dry run fails", async () => {
    previewFails = true;
    await renderLoaded();
    await userEvent.click(bootstrapButton(CURRENT_MONTH));

    expect(await screen.findByText("Calendar unavailable")).toBeInTheDocument();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(bootstrapBodies).toHaveLength(1);
  });
});

describe("HostsClient schedule table", () => {
  it("marks a new-member host with the eligibility badge", async () => {
    await renderLoaded();
    const row = screen.getByText("Hazel Burrowes").closest("tr") as HTMLElement;
    expect(within(row).getByText("New member — eligible 2026-10-10")).toBeInTheDocument();
  });
});
