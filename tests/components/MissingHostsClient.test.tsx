// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TimezoneProvider } from "@/components/Timezone";
import type { MissingHostsData } from "@/lib/missing-hosts";

const actions = vi.hoisted(() => ({
  getUnhostedPrickles: vi.fn(),
  setRequiresHost: vi.fn(async () => ({})),
  setDefaultHost: vi.fn(async () => ({})),
}));
vi.mock("@/app/(admin)/admin/data-health/missing-hosts/actions", () => actions);
vi.mock("@/components/MemberSearch", () => ({
  default: ({ onSelect }: { onSelect: (m: { id: string } | null) => void }) => (
    <button onClick={() => onSelect({ id: "mbr_AAAAAAAAAAA1" })}>pick a default host</button>
  ),
}));

import MissingHostsClient from "@/app/(admin)/admin/data-health/missing-hosts/MissingHostsClient";

const data: MissingHostsData = {
  stats: [
    { typeId: "t1", typeName: "Sprint", requiresHost: true, missingCount: 4, defaultHostId: null, defaultHostName: null },
    { typeId: "t2", typeName: "Chat", requiresHost: false, missingCount: 3, defaultHostId: null, defaultHostName: null },
  ],
  coverage: { total: 20, requiresHost: { withHost: 6, withoutHost: 4 }, optionalHost: { withHost: 7, withoutHost: 3 } },
  members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" }],
};

const renderPage = () =>
  render(
    <TimezoneProvider zone="UTC">
      <MissingHostsClient {...data} />
    </TimezoneProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  actions.getUnhostedPrickles.mockResolvedValue({
    prickles: [{ id: "p1", title: null, startTime: "2026-10-19T15:00:00Z", endTime: "2026-10-19T16:00:00Z", typeName: "Sprint" }],
  });
});

describe("MissingHostsClient", () => {
  it("separates the data-quality issues from the types that expect no host, with their counts", () => {
    renderPage();

    expect(screen.getByText("4", { selector: "p.text-2xl" })).toBeInTheDocument(); // prickles requiring hosts
    expect(screen.getByText("3", { selector: "p.text-2xl" })).toBeInTheDocument(); // intentionally unhosted
    expect(screen.getByText("4 prickles missing hosts")).toBeInTheDocument();
    expect(screen.getByText("3 prickles (host not required)")).toBeInTheDocument();
  });

  it("opens the detailed breakdown of every calendar prickle", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Detailed Breakdown/ }));

    expect(screen.getByText("Total calendar Prickles: 20")).toBeInTheDocument();
    expect(screen.getByText(/^With hosts: 13 \(6 requiring \+ 7 not requiring\)/)).toBeInTheDocument();
    expect(screen.getByText(/^Without hosts: 7 \(4 requiring \+ 3 not requiring\)/)).toBeInTheDocument();
  });

  it("lists a type's unhosted prickles when you view it", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => expect(actions.getUnhostedPrickles).toHaveBeenCalledWith("t1"));
    expect(await screen.findByRole("link", { name: /Sprint/ })).toHaveAttribute("href", "/admin/prickles/p1");
    expect(screen.getByText("Sprint - Missing Hosts")).toBeInTheDocument();
  });

  it("flips whether a type needs a host, and sets its default host", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Mark Optional" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark Required" }));
    await userEvent.click(screen.getAllByRole("button", { name: "pick a default host" })[0]);

    expect(actions.setRequiresHost).toHaveBeenNthCalledWith(1, "t1", false);
    expect(actions.setRequiresHost).toHaveBeenNthCalledWith(2, "t2", true);
    expect(actions.setDefaultHost).toHaveBeenCalledWith("t1", "mbr_AAAAAAAAAAA1");
  });

  it("tells the admin when an update fails", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    actions.setRequiresHost.mockResolvedValueOnce({ error: "nope" } as never);
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Mark Optional" }));

    expect(alert).toHaveBeenCalledWith("Failed to update: nope");
  });
});
