// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MilestonesPanel } from "@/app/(member)/settings/MilestonesPanel";
import * as actions from "@/app/(member)/settings/milestoneActions";
import { MILESTONE_CONSENTS } from "@/lib/finishers";
import type { Milestone } from "@/lib/data/milestones";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({ answerMilestone: vi.fn() }));

const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  status: "proposed",
  source: "staff",
  achievedOn: null,
  storyBefore: null,
  storyAfter: null,
  consentProfile: false,
  consentHomepage: false,
  consentTestimonial: false,
  confirmedAt: null,
  createdAt: "2026-11-20T12:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MilestonesPanel", () => {
  it("shows nothing when there is nothing to ask", () => {
    const { container } = render(<MilestonesPanel milestones={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks about a proposal in plain words and promises nothing is public", () => {
    render(<MilestonesPanel milestones={[milestone()]} />);
    expect(screen.getByRole("heading", { name: "Your milestones" })).toBeInTheDocument();
    expect(screen.getByText(/You wrote THE END on a book/)).toBeInTheDocument();
    expect(screen.getByText(/Suggested by the Quill & Cup team/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is shown to anyone until you choose where/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, this is me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not me / not yet" })).toBeInTheDocument();
  });

  it("opens the form with every consent unticked and sends only what was ticked", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} />);

    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(MILESTONE_CONSENTS.length);
    for (const box of boxes) expect(box).not.toBeChecked();

    await user.type(screen.getByLabelText(/When did it happen/), "2026-05-01");
    await user.type(screen.getByLabelText(/before you got here/), "Stuck in chapter two.");
    await user.click(screen.getByRole("checkbox", { name: /My writer profile/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledTimes(1));
    expect(actions.answerMilestone).toHaveBeenCalledWith({
      id: "mlst_AAAAAAAAAAA1",
      answer: "confirm",
      achievedOn: "2026-05-01",
      storyBefore: "Stuck in chapter two.",
      storyAfter: "",
      consents: { consent_profile: true, consent_homepage: false, consent_testimonial: false },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("confirms with no ticks at all when the member ticks nothing", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} />);
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalled());
    expect(vi.mocked(actions.answerMilestone).mock.calls[0][0]).toMatchObject({ consents: { consent_profile: false, consent_homepage: false, consent_testimonial: false } });
  });

  it("declines with one click and no form", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} />);
    await user.click(screen.getByRole("button", { name: "Not me / not yet" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledWith({ id: "mlst_AAAAAAAAAAA1", answer: "decline" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows the reason when saving fails and keeps the form open", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ error: "That date is still ahead of us." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} />);
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That date is still ahead of us.");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("shows what a confirmed milestone is allowed to be used for, and lets the member change it", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "2026-11-21", consentHomepage: true })]} />);
    expect(screen.getByText(/we may show it on: The Quill & Cup homepage/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("checkbox", { name: /homepage/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /My writer profile/ })).not.toBeChecked();
  });

  it("says a confirmed milestone with no ticks stays private", () => {
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "2026-11-21" })]} />);
    expect(screen.getByText(/stays private/)).toBeInTheDocument();
  });

  it("lets a declined one be reopened", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "declined" })]} />);
    expect(screen.getByText(/We won.t show it anywhere/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actually, it is me" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("is look-only while an admin views as the member", () => {
    render(<MilestonesPanel milestones={[milestone()]} readOnly />);
    expect(screen.getByRole("button", { name: "Yes, this is me" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not me / not yet" })).toBeDisabled();
    expect(screen.getByText(/viewing as this member/)).toBeInTheDocument();
  });
});
