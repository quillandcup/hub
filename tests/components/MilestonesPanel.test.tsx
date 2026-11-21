// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MilestonesPanel } from "@/app/(member)/settings/MilestonesPanel";
import * as actions from "@/app/(member)/settings/milestoneActions";
import { MILESTONE_CONSENTS, MILESTONE_LABELS, MILESTONE_SELF_ADD, MILESTONE_TITLES, PUBLISHED_TITLE } from "@/lib/finishers";
import type { Milestone } from "@/lib/data/milestones";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({ answerMilestone: vi.fn(), addMilestone: vi.fn(), takeBackMilestone: vi.fn() }));

const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  projectId: null,
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
  it("is always there, with all three milestones, even for a member with nothing yet", () => {
    render(<MilestonesPanel milestones={[]} />);
    expect(screen.getByRole("heading", { name: "Your milestones" })).toBeInTheDocument();
    expect(screen.getByText(/You wrote THE END on a book/)).toBeInTheDocument();
    expect(screen.getByText(/You revised a book until it was ready to publish/)).toBeInTheDocument();
    expect(screen.getByText(/You published a book/)).toBeInTheDocument();
    // Titles and the stamp label come from lib/finishers.ts, not repeated here.
    expect(screen.getByText(new RegExp(`${MILESTONE_TITLES.the_end}, ${MILESTONE_LABELS.the_end}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${MILESTONE_TITLES.publish_ready}, ${MILESTONE_LABELS.publish_ready}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PUBLISHED_TITLE))).toBeInTheDocument();
    expect(screen.getAllByText(/Not added yet/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button })).toBeEnabled();
    expect(screen.getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button })).toBeEnabled();
    expect(screen.queryByText(/Waiting for you to confirm/)).not.toBeInTheDocument();
  });

  it("derives the third milestone from the Bookshelf and links to it, with no button to add it", () => {
    const { rerender } = render(<MilestonesPanel milestones={[]} books={[{ id: "book_A1", title: "A Fake Book" }]} />);
    expect(screen.getByText(/Confirmed by your Bookshelf: A Fake Book/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your Bookshelf" })).toHaveAttribute("href", "/bookshelf");
    rerender(<MilestonesPanel milestones={[]} books={[{ id: "book_A1", title: "One" }, { id: "book_A2", title: "Two" }]} />);
    expect(screen.getByText(/Confirmed by your Bookshelf: 2 books/)).toBeInTheDocument();
    rerender(<MilestonesPanel milestones={[]} />);
    expect(screen.getByText(/Not yet\. This appears by itself/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the Bookshelf" })).toHaveAttribute("href", "/bookshelf");
  });

  it("adds THE END in one step: the form opens with every consent unticked and sends the kind, project and ticks", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[{ id: "wpr_A1", title: "My Fake Novel" }]} />);

    await user.click(screen.getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText(/When did it happen/), "2026-05-01");
    await user.selectOptions(screen.getByLabelText(/Which project was it/), "wpr_A1");
    await user.type(screen.getByLabelText(/how does it feel now/i), "Done.");
    await user.click(screen.getByRole("checkbox", { name: /homepage/ }));
    await user.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(1));
    expect(actions.addMilestone).toHaveBeenCalledWith({
      kind: "the_end",
      achievedOn: "2026-05-01",
      storyBefore: "",
      storyAfter: "Done.",
      consents: { consent_profile: false, consent_homepage: true, consent_testimonial: false },
      projectId: "wpr_A1",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.answerMilestone).not.toHaveBeenCalled();
  });

  it("adds the publish-ready milestone with nothing filled in, and offers no project picker without projects", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: false });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} />);
    await user.click(screen.getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button }));
    expect(screen.queryByLabelText(/Which project was it/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalled());
    expect(actions.addMilestone).toHaveBeenCalledWith({
      kind: "publish_ready",
      achievedOn: null,
      storyBefore: "",
      storyAfter: "",
      consents: { consent_profile: false, consent_homepage: false, consent_testimonial: false },
      projectId: null,
    });
  });

  it("shows why adding failed and keeps the form open, and cancel closes it", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ error: "That date is still ahead of us." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} />);
    await user.click(screen.getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
    await user.click(screen.getByRole("button", { name: "Add it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That date is still ahead of us.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button })).toBeInTheDocument();
  });

  it("shows a milestone the member added with its date and project, and takes it back only after a confirmation", async () => {
    vi.mocked(actions.takeBackMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(
      <MilestonesPanel
        milestones={[milestone({ status: "confirmed", source: "member", achievedOn: "2026-05-01", projectId: "wpr_A1", confirmedAt: "2026-11-21" })]}
        projects={[{ id: "wpr_A1", title: "My Fake Novel" }]}
      />,
    );
    expect(screen.getByText(/Confirmed \(May 1, 2026\), for My Fake Novel/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not me / not yet" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take it back" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(`Take back ${MILESTONE_LABELS.the_end}?`);
    expect(actions.takeBackMilestone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.takeBackMilestone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Take it back" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(actions.takeBackMilestone).toHaveBeenCalledWith("mlst_AAAAAAAAAAA1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows why a take-back failed", async () => {
    vi.mocked(actions.takeBackMilestone).mockResolvedValue({ error: "We couldn't find that milestone." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", source: "member", confirmedAt: "2026-11-21" })]} />);
    await user.click(screen.getByRole("button", { name: "Take it back" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find that milestone.");
  });

  it("says a proposal is waiting, and shows the other milestone as not added", () => {
    render(<MilestonesPanel milestones={[milestone()]} />);
    expect(screen.getByText(/Waiting for you to confirm/)).toBeInTheDocument();
    expect(screen.getAllByText(/Not added yet/)).toHaveLength(1);
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
    expect(screen.getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button })).toBeDisabled();
    expect(screen.getByText(/viewing as this member/)).toBeInTheDocument();
  });
});
