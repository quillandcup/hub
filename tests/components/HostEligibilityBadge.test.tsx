// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HostEligibilityBadge } from "@/app/(admin)/admin/hosts/HostsClient";

describe("HostEligibilityBadge", () => {
  it("renders nothing for an eligible host", () => {
    const { container } = render(
      <HostEligibilityBadge eligibility={{ eligible: true, tenureStartDate: "2025-01-01", eligibleOn: "2025-02-01" }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when eligibility is missing", () => {
    const { container } = render(<HostEligibilityBadge eligibility={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a host who hasn't been a member for a full month", () => {
    render(
      <HostEligibilityBadge eligibility={{ eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" }} />
    );
    expect(screen.getByText("New member — eligible 2026-10-10")).toBeInTheDocument();
  });

  it("marks a host with no join date on record", () => {
    render(<HostEligibilityBadge eligibility={{ eligible: false, tenureStartDate: null, eligibleOn: null }} />);
    expect(screen.getByText("Join date unknown")).toBeInTheDocument();
  });
});
