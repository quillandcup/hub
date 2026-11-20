// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinishersClient from "@/app/(admin)/admin/finishers/FinishersClient";
import * as actions from "@/app/(admin)/admin/finishers/actions";
import type { StaffMilestone } from "@/lib/data/milestones";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/finishers/actions", () => ({
  proposeMilestonesFromBooks: vi.fn(),
  proposeMilestone: vi.fn(),
  withdrawMilestone: vi.fn(),
}));

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Legalname", displayName: "Ada Example", status: "active", email: "ada@example.com" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null, status: "active", email: "bo@example.com" },
];

const row = (overrides: Partial<StaffMilestone> = {}): StaffMilestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  status: "proposed",
  source: "staff",
  achievedOn: null,
  createdAt: "2026-11-20T12:00:00Z",
  name: "Ada Legalname",
  displayName: "Ada Example",
  ...overrides,
});

const renderPage = (props: Partial<React.ComponentProps<typeof FinishersClient>> = {}) =>
  render(
    <FinishersClient counts={{ proposed: 3, confirmed: 1, declined: 0 }} rows={[row()]} hasNext={false} page={1} status={null} members={members} {...props} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FinishersClient", () => {
  it("shows the counts, links each to its list, and names members by display name", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /3\s*Proposed/ })).toHaveAttribute("href", "/admin/finishers?status=proposed");
    expect(screen.getByRole("link", { name: /1\s*Confirmed/ })).toHaveAttribute("href", "/admin/finishers?status=confirmed");
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.queryByText("Ada Legalname")).not.toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("THE END")).toBeInTheDocument();
    expect(table.getByText(/Suggested by the Quill & Cup team/i)).toBeInTheDocument();
  });

  it("asks before the backfill, then reports how many it proposed", async () => {
    vi.mocked(actions.proposeMilestonesFromBooks).mockResolvedValue({ success: true, added: 12 });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Propose from published books" }));
    expect(screen.getByText("Propose milestones from published books?")).toBeInTheDocument();
    expect(actions.proposeMilestonesFromBooks).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Propose milestones" }));
    await waitFor(() => expect(actions.proposeMilestonesFromBooks).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Proposed 12 milestones.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the backfill had nothing new, and shows an error from the server", async () => {
    vi.mocked(actions.proposeMilestonesFromBooks).mockResolvedValueOnce({ success: true, added: 0 }).mockResolvedValueOnce({ error: "Not authorized" });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Propose from published books" }));
    await user.click(screen.getByRole("button", { name: "Propose milestones" }));
    expect(await screen.findByText("Nothing new to propose.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Propose from published books" }));
    await user.click(screen.getByRole("button", { name: "Propose milestones" }));
    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
  });

  it("keeps Cancel from running the backfill", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Propose from published books" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.proposeMilestonesFromBooks).not.toHaveBeenCalled();
  });

  it("adds one by hand for the chosen member and milestone", async () => {
    vi.mocked(actions.proposeMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("button", { name: "Add proposal" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Search for a member..."), "Bo");
    await user.click(await screen.findByText("Bo Example"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Milestone" }), "publish_ready");
    await user.click(screen.getByRole("button", { name: "Add proposal" }));
    await waitFor(() => expect(actions.proposeMilestone).toHaveBeenCalledWith({ memberId: "mbr_AAAAAAAAAAA2", kind: "publish_ready" }));
    expect(await screen.findByText("Added as a proposal.")).toBeInTheDocument();
  });

  it("says when the member already has that milestone", async () => {
    vi.mocked(actions.proposeMilestone).mockResolvedValue({ success: true, added: false });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText("Search for a member..."), "Bo");
    await user.click(await screen.findByText("Bo Example"));
    await user.click(screen.getByRole("button", { name: "Add proposal" }));
    expect(await screen.findByText("That member already has this milestone.")).toBeInTheDocument();
  });

  it("takes back a proposal after confirming, and offers it only for proposals", async () => {
    vi.mocked(actions.withdrawMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage({ rows: [row(), row({ id: "mlst_AAAAAAAAAAA2", status: "confirmed", name: "Bo Example", displayName: null })] });
    expect(screen.getAllByRole("button", { name: "Take back" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(screen.getByText("Take back this proposal?")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Take back" }).at(-1)!);
    await waitFor(() => expect(actions.withdrawMilestone).toHaveBeenCalledWith("mlst_AAAAAAAAAAA1"));
    expect(await screen.findByText("Taken back.")).toBeInTheDocument();
  });

  it("pages the list and filters by status", () => {
    renderPage({ page: 2, hasNext: true, status: "proposed" });
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/finishers?status=proposed");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/finishers?status=proposed&page=3");
    expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute("href", "/admin/finishers");
  });

  it("says so when nothing is listed", () => {
    renderPage({ rows: [] });
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});
