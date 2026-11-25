// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/app/(admin)/admin/members/[id]/notifications-actions", () => ({ loadMemberNotifications: load }));

import MemberNotifications from "@/app/(admin)/admin/members/[id]/MemberNotifications";

afterEach(() => {
  cleanup();
  load.mockReset();
});

describe("MemberNotifications", () => {
  it("shows a loading line, then the member's devices and email", async () => {
    load.mockResolvedValue({ devices: ["Safari on Mac"], newcomer: false, kinds: [] });
    render(<MemberNotifications memberId="mbr_AAAAAAAAAAA1" email="ada@example.test" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading notification settings");
    expect(await screen.findByText(/1 device \(Safari on Mac\)/)).toBeInTheDocument();
    expect(screen.getByText(/ada@example.test/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1");
  });

  it("shows the reason when the load is refused or fails", async () => {
    load.mockResolvedValueOnce({ error: "Not authorized" });
    const { unmount } = render(<MemberNotifications memberId="m1" email="a@example.test" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
    unmount();
    load.mockRejectedValueOnce(new Error("boom"));
    render(<MemberNotifications memberId="m2" email="a@example.test" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the notification settings.");
  });
});
