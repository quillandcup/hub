// @vitest-environment jsdom
/**
 * Admin Hosts "Add Schedule" form: warns up front (on leaving the Host Email
 * field, before saving) when the chosen member hasn't been a member for a full
 * month yet -- but still lets the admin save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostsClient, { HostEligibilityWarning } from "@/app/(admin)/admin/hosts/HostsClient";
import type { HostEligibility } from "@/lib/host-eligibility";

const MEMBERS: Record<string, { id: string; name: string; email: string; host_eligibility: HostEligibility }> = {
  "new@example.test": {
    id: "member-new",
    name: "New Hedgie",
    email: "new@example.test",
    host_eligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
  },
  "nodate@example.test": {
    id: "member-nodate",
    name: "Dateless Hedgie",
    email: "nodate@example.test",
    host_eligibility: { eligible: false, tenureStartDate: null, eligibleOn: null },
  },
  "veteran@example.test": {
    id: "member-veteran",
    name: "Veteran Hedgie",
    email: "veteran@example.test",
    host_eligibility: { eligible: true, tenureStartDate: "2021-01-01", eligibleOn: "2021-02-01" },
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
let createdBodies: Record<string, unknown>[];

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
}

beforeEach(() => {
  createdBodies = [];
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/members?email=")) {
      const email = new URL(url, "http://localhost").searchParams.get("email") ?? "";
      const member = MEMBERS[email];
      return jsonResponse({ members: member ? [member] : [] });
    }
    if (url === "/api/prickle-schedules" && init?.method === "POST") {
      createdBodies.push(JSON.parse(String(init.body)));
      return jsonResponse({ schedule: { id: "new-schedule" } });
    }
    if (url.startsWith("/api/prickle-schedules?month=")) return jsonResponse({ schedules: [] });
    if (url === "/api/prickle-schedule-locks") return jsonResponse({ locks: [] });
    return jsonResponse({ error: `unexpected fetch ${url}` }, false);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openForm() {
  render(<HostsClient prickleTypes={[{ id: "type-progress", name: "Progress Prickle" }]} />);
  await screen.findByText("No schedules for this month yet.");
  await userEvent.click(screen.getByRole("button", { name: "Add Schedule" }));
  return screen.getByLabelText("Host Email");
}

async function enterHostEmail(email: string) {
  const input = await openForm();
  await userEvent.type(input, email);
  await userEvent.tab(); // blur -> lookup
  return input;
}

describe("HostsClient add-host eligibility warning", () => {
  it("warns before saving when the member isn't eligible yet, with the eligible-on date", async () => {
    await enterHostEmail("new@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "hasn't been a member for a full month yet (eligible to host from 2026-10-10)"
    );
    expect(createdBodies).toEqual([]);
  });

  it("warns when the member has no join date on record", async () => {
    await enterHostEmail("nodate@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent("no join date on record");
  });

  it("shows no warning for an eligible member", async () => {
    await enterHostEmail("veteran@example.test");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/members?email=${encodeURIComponent("veteran@example.test")}`)
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides a stale warning once the email is edited", async () => {
    const input = await enterHostEmail("new@example.test");
    await screen.findByRole("alert");
    await userEvent.type(input, "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still lets the admin save an ineligible member", async () => {
    await enterHostEmail("new@example.test");
    await screen.findByRole("alert");
    await userEvent.selectOptions(screen.getByLabelText("Prickle Type"), "type-progress");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createdBodies).toHaveLength(1));
    expect(createdBodies[0]).toMatchObject({ host_id: "member-new", type_id: "type-progress" });
  });
});

describe("HostEligibilityWarning", () => {
  it("renders nothing for an eligible member or a missing lookup", () => {
    const { container, rerender } = render(<HostEligibilityWarning eligibility={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <HostEligibilityWarning eligibility={{ eligible: true, tenureStartDate: "2021-01-01", eligibleOn: "2021-02-01" }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
