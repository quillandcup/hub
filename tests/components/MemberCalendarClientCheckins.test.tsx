// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberCalendarClient from "@/components/MemberCalendarClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/writing/PrickleCheckModal", () => ({
  default: ({ prickleId, half }: { prickleId: string; half: string }) => (
    <div role="dialog">{`${half} modal for ${prickleId}`}</div>
  ),
}));

Element.prototype.scrollIntoView = vi.fn();

const NOW = new Date();
const join = new Date(NOW.getFullYear(), NOW.getMonth(), 1, 12).toISOString();
const ATTENDANCE = [
  {
    id: "a1",
    join_time: join,
    leave_time: new Date(Date.parse(join) + 3600_000).toISOString(),
    prickles: { id: "p1", host: { id: "h1", name: "Jenn P" }, prickle_types: { name: "Progress Prickle" } },
  },
];

function renderClient(props: Partial<React.ComponentProps<typeof MemberCalendarClient>> = {}) {
  return render(
    <MemberCalendarClient memberId="m1" attendance={ATTENDANCE} defaultTimezone="UTC" checkins={{}} {...props} />
  );
}

describe("MemberCalendarClient check-in pills", () => {
  it("adds the pills to the month view's day panel and opens the modal from them", async () => {
    const user = userEvent.setup();
    renderClient({ initialView: "month" });
    expect(screen.queryByRole("button", { name: "Check in →" })).not.toBeInTheDocument();

    await user.click(screen.getByText("1", { selector: "div" }));
    await user.click(await screen.findByRole("button", { name: "Check out →" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("checkout modal for p1");
  });

  it("has no pills without the viewer's own check-ins", async () => {
    const user = userEvent.setup();
    renderClient({ initialView: "month", checkins: undefined });
    await user.click(screen.getByText("1", { selector: "div" }));
    expect(screen.queryByRole("button", { name: /Check (in|out)/ })).not.toBeInTheDocument();
  });

  it("opens the modal on load for a link from a DM", () => {
    renderClient({ initialView: "list", initialCheck: { prickleId: "p1", half: "checkin", prefill: null } });
    expect(screen.getByRole("dialog")).toHaveTextContent("checkin modal for p1");
  });
});
