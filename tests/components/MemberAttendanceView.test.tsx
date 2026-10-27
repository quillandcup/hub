// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberAttendanceView from "@/components/MemberAttendanceView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const record = (id: string, host: { id: string; name: string; display_name: string | null }) => ({
  id,
  join_time: "2026-10-05T15:00:00Z",
  leave_time: "2026-10-05T16:00:00Z",
  prickles: { id: `p-${id}`, host, start_time: "2026-10-05T15:00:00Z", end_time: "2026-10-05T16:00:00Z", prickle_types: { name: "Midnight Crew" } },
});

describe("MemberAttendanceView (admin member page)", () => {
  it("names each prickle's host by display name, falling back to the legal name", async () => {
    render(
      <MemberAttendanceView
        member={{ id: "mbr_AAAAAAAAAAA1" }}
        attendanceRecords={[
          record("a1", { id: "mbr_AAAAAAAAAAA2", name: "Laura May Best", display_name: "Bestie" }),
          record("a2", { id: "mbr_AAAAAAAAAAA3", name: "Ann Example", display_name: null }),
        ]}
        userTimezonePreference="America/New_York"
        memberBasePath="/admin/members"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "List" }));

    expect(screen.getAllByRole("link", { name: "Bestie" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Ann Example" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Laura May Best")).not.toBeInTheDocument();
  });

  it("sorts the list by the host's display name", async () => {
    render(
      <MemberAttendanceView
        member={{ id: "mbr_AAAAAAAAAAA1" }}
        attendanceRecords={[
          record("a1", { id: "mbr_AAAAAAAAAAA2", name: "Aaa Example", display_name: "Zed E" }),
          record("a2", { id: "mbr_AAAAAAAAAAA3", name: "Zzz Example", display_name: "Abe E" }),
        ]}
        userTimezonePreference="America/New_York"
        memberBasePath="/admin/members"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "List" }));
    await userEvent.click(screen.getByText("Host"));

    const hosts = screen.getAllByRole("link").map((l) => l.textContent).filter((t) => t === "Abe E" || t === "Zed E");
    expect(hosts).toEqual(["Abe E", "Zed E"]);
  });
});
