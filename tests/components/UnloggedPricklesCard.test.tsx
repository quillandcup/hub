// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UnloggedPricklesCard from "@/components/writing/UnloggedPricklesCard";
import { dismissUnloggedPrickle } from "@/app/(member)/projects/actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/writing/PrickleCheckModal", () => ({
  default: ({ prickleId, half }: { prickleId: string; half: string }) => (
    <div role="dialog">{`${half} modal for ${prickleId}`}</div>
  ),
}));
vi.mock("@/app/(member)/projects/actions", () => ({ dismissUnloggedPrickle: vi.fn() }));

const PRICKLES = [
  { id: "p1", label: "Thu, Oct 1 · 9:00 AM · Morning Sprint", startTime: "2026-10-01T13:00:00Z", attended: true },
  { id: "p2", label: "Wed, Sep 30 · 7:00 PM · Night Owls", startTime: "2026-09-30T23:00:00Z", attended: true },
];

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(dismissUnloggedPrickle).mockReset().mockResolvedValue({ success: true });
});

describe("UnloggedPricklesCard", () => {
  it("dismisses a prickle: hides it, saves it and refreshes", async () => {
    render(<UnloggedPricklesCard prickles={PRICKLES} />);

    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));

    expect(screen.queryByText(PRICKLES[0].label)).not.toBeInTheDocument();
    expect(screen.getByText(PRICKLES[1].label)).toBeInTheDocument();
    expect(dismissUnloggedPrickle).toHaveBeenCalledWith("p1");
    expect(refresh).toHaveBeenCalled();
  });

  it("disappears once every prickle is dismissed", async () => {
    const { container } = render(<UnloggedPricklesCard prickles={[PRICKLES[0]]} />);
    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));
    expect(container).toBeEmptyDOMElement();
  });

  it("brings the prickle back with an error when the save fails", async () => {
    vi.mocked(dismissUnloggedPrickle).mockResolvedValue({ error: "Couldn't dismiss that prickle — please try again." });
    render(<UnloggedPricklesCard prickles={PRICKLES} />);

    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));

    expect(await screen.findByText("Couldn't dismiss that prickle — please try again.")).toBeInTheDocument();
    expect(screen.getByText(PRICKLES[0].label)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers Check out → on each row, opening the check-out modal in place", async () => {
    render(<UnloggedPricklesCard prickles={PRICKLES} />);
    expect(screen.queryByRole("button", { name: "Log" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Check out →" })[1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("checkout modal for p2");
  });
});
