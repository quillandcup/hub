// @vitest-environment jsdom
/**
 * Admin screens that show a member by display name: the Hosts schedule table and the host picker
 * in the unmatched-events modal. The legal name sits beneath only when it differs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostsClient from "@/app/(admin)/admin/hosts/HostsClient";
import UnmatchedEventsTable from "@/app/(admin)/admin/data/prickle-types/UnmatchedEventsTable";
import { getMonthStart } from "@/lib/prickle-schedules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const CURRENT_MONTH = getMonthStart(new Date()).toISOString().slice(0, 10);

function schedule(i: number, member: { name: string; display_name?: string | null }) {
  return {
    id: `sched-${i}`, host_id: `member-${i}`, type_id: "type-progress", month: CURRENT_MONTH,
    recurrence_type: "weekly", day_of_week: i, recurrence_anchor_date: null, week_of_month: null, event_date: null,
    start_time_local: "10:00", timezone: "America/New_York", status: "confirmed", notes: null, carried_forward_from: null,
    member: { id: `member-${i}`, email: `host${i}@example.test`, ...member },
    prickle_type: { id: "type-progress", name: "Progress Prickle" },
    host_eligibility: { eligible: true },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("HostsClient host cell", () => {
  beforeEach(() => {
    const schedules = [
      schedule(1, { name: "Zed Legal", display_name: "Ada E" }),
      schedule(2, { name: "Bea Plain", display_name: null }),
      schedule(3, { name: "Cy Same", display_name: "Cy Same" }),
    ];
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      const url = String(input);
      const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
      if (url.startsWith("/api/prickle-schedules?month=")) return json({ schedules: new URL(url, "http://localhost").searchParams.get("month") === CURRENT_MONTH ? schedules : [] });
      if (url === "/api/prickle-schedule-locks") return json({ locks: [] });
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: url }) });
    }));
  });

  const rows = () => within(screen.getAllByRole("table").at(-1)!).getAllByRole("row").slice(1);

  it("leads with the display name, shows the legal name beneath only when it differs, and sorts by what is shown", async () => {
    render(<HostsClient prickleTypes={[{ id: "type-progress", name: "Progress Prickle" }]} />);
    await screen.findByText("Ada E");

    expect(screen.getByRole("link", { name: "Ada E" })).toBeInTheDocument();
    expect(screen.getByText("Zed Legal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bea Plain" })).toBeInTheDocument();
    expect(screen.queryAllByText("Bea Plain")).toHaveLength(1);
    expect(screen.queryAllByText("Cy Same")).toHaveLength(1);

    await userEvent.click(screen.getByText("Host"));
    const first = rows().map((r) => within(r).getAllByRole("cell")[0].querySelector("a")?.textContent);
    // Ada E (display) sorts before Bea and Cy, though the legal name Zed Legal would sort last.
    expect(first).toEqual(["Ada E", "Bea Plain", "Cy Same"]);
  });
});

describe("UnmatchedEventsTable host picker", () => {
  const group = { summary: "Sprint", count: 2, eventIds: ["e1"], calendarEventIds: ["c1"], suggestedType: null, suggestedHost: null };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: string) => {
      if (input === "/api/members") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              { id: "m1", name: "Zed Legal", displayName: "Ada E", email: "one@example.test" },
              { id: "m2", name: "Bea Plain", displayName: null, email: "two@example.test" },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  async function openPicker() {
    render(<UnmatchedEventsTable eventGroups={[group]} prickleTypes={[{ id: "t1", name: "Sprint", normalized_name: "sprint" }]} />);
    await userEvent.click(screen.getByText("Review"));
    const input = screen.getByPlaceholderText(/Search for a member/);
    await userEvent.click(input);
    return input;
  }

  it("shows display name with legal beneath when it differs, and filters on display name, legal name and email", async () => {
    const input = await openPicker();
    const option = (text: string) => screen.getByText(text).closest("button")!;

    expect(within(await screen.findByText("Ada E").then(() => option("Ada E"))).getByText("Zed Legal")).toBeInTheDocument();
    expect(screen.queryAllByText("Bea Plain")).toHaveLength(1);

    await userEvent.type(input, "ada");
    expect(screen.queryByText("Bea Plain")).toBeNull();
    expect(screen.getByText("Ada E")).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "zed");
    expect(screen.getByText("Ada E")).toBeInTheDocument();
    expect(screen.queryByText("Bea Plain")).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "two@");
    expect(screen.getByText("Bea Plain")).toBeInTheDocument();
    expect(screen.queryByText("Ada E")).toBeNull();
  });

  it("leaves no pending blur timer behind when the table unmounts", async () => {
    const input = await openPicker();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.blur(input);
      expect(vi.getTimerCount()).toBe(1); // hides the dropdown in 200 ms
      cleanup();
      expect(vi.getTimerCount()).toBe(0); // otherwise it fires into a torn-down DOM ("window is not defined")
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the legal name into the host field when a member is picked", async () => {
    const input = await openPicker();
    await userEvent.click((await screen.findByText("Ada E")).closest("button")!);
    expect((input as HTMLInputElement).value).toBe("Zed Legal");

    await userEvent.click(screen.getByRole("button", { name: /Create 2 Prickles/ }));
    const post = fetchMock.mock.calls.find(([url]) => url === "/api/prickle-types/resolve-batch")!;
    expect(JSON.parse(post[1].body).host).toBe("Zed Legal");
  });
});
