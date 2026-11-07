// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberNotificationsPanel from "@/app/(admin)/admin/members/[id]/MemberNotificationsPanel";

describe("MemberNotificationsPanel", () => {
  it("lists devices, the email address and each kind's channels, marking a changed choice", () => {
    render(
      <MemberNotificationsPanel
        devices={["Safari on iPhone", "Chrome on Mac"]}
        email="moss@example.test"
        newcomer
        kinds={[{ id: "prickle_checkin", category: "Prickles", label: "Prickle check-ins", channels: ["in_app"], changed: ["slack"] }]}
      />
    );
    expect(screen.getByText(/2 devices \(Safari on iPhone, Chrome on Mac\)/)).toBeInTheDocument();
    expect(screen.getByText(/moss@example.test/)).toBeInTheDocument();
    expect(screen.getByText(/first 90 days/)).toBeInTheDocument();
    const row = screen.getByText("Prickle check-ins").closest("tr")!;
    expect(row).toHaveTextContent("Off*");
    expect(row).toHaveTextContent("On");
  });

  it("says so when no device has Browser notifications on", () => {
    render(<MemberNotificationsPanel devices={[]} email="a@example.test" newcomer={false} kinds={[]} />);
    expect(screen.getByText(/not on for any device/)).toBeInTheDocument();
  });
});
