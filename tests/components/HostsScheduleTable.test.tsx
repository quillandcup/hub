// @vitest-environment jsdom
/**
 * Admin Hosts schedule table on the shared useDataTable: sortable Host /
 * Schedule / Status headers, and the standard pager once a month has more
 * than 50 schedules. The eligibility badge still renders per row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostsClient from "@/app/(admin)/admin/hosts/HostsClient";
import { getMonthStart } from "@/lib/prickle-schedules";

const CURRENT_MONTH = getMonthStart(new Date()).toISOString().slice(0, 10);

function schedule(i: number, name: string, status: string, eligible = true) {
  return {
    id: `sched-${i}`,
    host_id: `member-${i}`,
    type_id: "type-progress",
    month: CURRENT_MONTH,
    recurrence_type: "weekly",
    day_of_week: (i % 7),
    recurrence_anchor_date: null,
    week_of_month: null,
    event_date: null,
    start_time_local: "10:00",
    timezone: "America/New_York",
    status,
    notes: null,
    carried_forward_from: null,
    member: { id: `member-${i}`, name, email: `host${i}@example.test` },
    prickle_type: { id: "type-progress", name: "Progress Prickle" },
    host_eligibility: eligible ? { eligible: true } : { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
  };
}

let monthSchedules: ReturnType<typeof schedule>[];

beforeEach(() => {
  monthSchedules = [
    schedule(1, "Juniper Quill", "confirmed"),
    schedule(2, "Aster Inkwell", "declined"),
    schedule(3, "Moss Penhallow", "proposed", false),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input);
      const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
      if (url.startsWith("/api/prickle-schedules?month=")) {
        const month = new URL(url, "http://localhost").searchParams.get("month");
        return json({ schedules: month === CURRENT_MONTH ? monthSchedules : [] });
      }
      if (url === "/api/prickle-schedule-locks") return json({ locks: [] });
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: url }) });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderLoaded(firstHost: string) {
  render(<HostsClient prickleTypes={[{ id: "type-progress", name: "Progress Prickle" }]} />);
  await screen.findByText(firstHost);
}

function hostColumn() {
  const rows = within(screen.getAllByRole("table").at(-1)!).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[0].querySelector("div")?.textContent);
}

describe("HostsClient schedule table", () => {
  it("links each host to their member profile and doesn't show emails", async () => {
    await renderLoaded("Juniper Quill");
    const link = screen.getByRole("link", { name: "Juniper Quill" });
    expect(link.getAttribute("href")).toMatch(/^\/admin\/members\/member-\d+$/);
    expect(screen.queryByText(/@example\.test/)).toBeNull();
  });

  it("sorts by Host and by Status (proposed first), keeping the eligibility badge", async () => {
    await renderLoaded("Juniper Quill");
    await userEvent.click(screen.getByText("Host"));
    expect(hostColumn()).toEqual(["Aster Inkwell", "Juniper Quill", "Moss Penhallow"]);
    await userEvent.click(screen.getByText("Host"));
    expect(hostColumn()).toEqual(["Moss Penhallow", "Juniper Quill", "Aster Inkwell"]);

    await userEvent.click(screen.getByText("Status"));
    expect(hostColumn()).toEqual(["Moss Penhallow", "Juniper Quill", "Aster Inkwell"]);
    expect(screen.getByText("New member — eligible 2026-10-10")).toBeInTheDocument();
  });

  it("pages a month with more than 50 schedules", async () => {
    monthSchedules = Array.from({ length: 55 }, (_, i) =>
      schedule(i, `Host ${String(i).padStart(2, "0")}`, "confirmed")
    );
    await renderLoaded("Host 00");
    expect(hostColumn()).toHaveLength(50);
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(hostColumn()).toEqual(["Host 50", "Host 51", "Host 52", "Host 53", "Host 54"]);
  });
});
