// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import PrickleCheckLinks from "@/components/writing/PrickleCheckLinks";
import { NEEDS, type CheckinInput } from "@/lib/prickle-checkins";

const NONE: CheckinInput = {
  pleasantBefore: null,
  energyBefore: null,
  emotionBefore: null,
  need: null,
  intentionMet: null,
  pleasantAfter: null,
  energyAfter: null,
  emotionAfter: null,
};
const CHECKED_IN: CheckinInput = { ...NONE, pleasantBefore: 4, energyBefore: 3, need: NEEDS[0].key };
const CHECKED_OUT: CheckinInput = { ...CHECKED_IN, intentionMet: 4, pleasantAfter: 4, energyAfter: 3 };

describe("PrickleCheckLinks", () => {
  it("offers the check-in as something to do, and the check-out only once the prickle has started", () => {
    const { rerender } = render(<PrickleCheckLinks prickleId="prkl_x" hasStarted={false} checkin={null} entries={[]} />);
    const checkIn = screen.getByRole("link", { name: "Check in →" });
    expect(checkIn).toHaveAttribute("href", "/my-prickles/history?checkin=prkl_x");
    expect(checkIn.className).toContain("text-plum-700");
    expect(screen.queryByRole("link", { name: /Check out/ })).not.toBeInTheDocument();

    rerender(<PrickleCheckLinks prickleId="prkl_x" hasStarted checkin={null} entries={[]} />);
    expect(screen.getByRole("link", { name: "Check out →" })).toHaveAttribute("href", "/my-prickles/history?checkout=prkl_x");
  });

  it("shows each half as done once it is answered, in the quieter style, and still links to it", () => {
    render(<PrickleCheckLinks prickleId="prkl_x" hasStarted checkin={CHECKED_OUT} entries={[]} />);
    const checkIn = screen.getByRole("link", { name: "Checked in ✓" });
    const checkOut = screen.getByRole("link", { name: "Checked out ✓" });
    for (const link of [checkIn, checkOut]) {
      expect(link.className).toContain("text-slate-600");
      expect(link.className).not.toContain("text-plum-700");
    }
    expect(checkIn).toHaveAttribute("href", expect.stringContaining("checkin=prkl_x"));
  });

  it("treats the halves separately: checked in but not yet out", () => {
    render(<PrickleCheckLinks prickleId="prkl_x" hasStarted checkin={CHECKED_IN} entries={[]} />);
    expect(screen.getByRole("link", { name: "Checked in ✓" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check out →" })).toBeInTheDocument();
  });

  it("summarises progress logged against the prickle", () => {
    render(
      <PrickleCheckLinks
        prickleId="prkl_x"
        hasStarted
        checkin={null}
        entries={[{ mode: "add", amount: 500, measure: "words", projectTitle: "Sample Book" } as never]}
      />,
    );
    expect(screen.getByText(/Logged\s+\+500 words on Sample Book/i)).toBeInTheDocument();
  });
});
