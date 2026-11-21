// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StageMilestoneDialog from "@/app/(member)/projects/[id]/StageMilestoneDialog";
import ProjectDetailView from "@/app/(member)/projects/[id]/ProjectDetailView";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";
import { updateProjectPhase } from "@/app/(member)/projects/actions";
import { answerStageMilestone } from "@/app/(member)/projects/stageMilestoneActions";
import { MILESTONE_CELEBRATION } from "@/lib/finishers";
import { STAGE_PROMPT, type StageMilestonePrompt } from "@/lib/milestone-prompts";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(member)/projects/stageMilestoneActions", () => ({ answerStageMilestone: vi.fn() }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({
  answerMilestone: vi.fn(),
  addMilestone: vi.fn(),
  takeBackMilestone: vi.fn(),
  setMilestoneVisibility: vi.fn(),
  setMilestoneShare: vi.fn(),
}));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn(), addBook: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  archiveGoal: vi.fn(),
  createGoal: vi.fn(),
  deleteEntry: vi.fn(),
  deleteGoal: vi.fn(),
  toggleGoalStar: vi.fn(),
  setGoalVisibility: vi.fn(),
  setProjectVisibility: vi.fn(),
  updateGoal: vi.fn(),
  updateProjectPhase: vi.fn(),
}));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectCharts", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectDetailsModal", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => <div role="dialog" aria-label="Publish flow" /> }));

const PROJECT = "wprj_AAAAAAAAAAA1";
const prompt = (over: Partial<StageMilestonePrompt> = {}): StageMilestonePrompt => ({ projectId: PROJECT, projectTitle: "A Fake Novel", kinds: ["the_end"], offerPublish: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(answerStageMilestone).mockResolvedValue({ success: true, saved: true });
});

const renderDialog = (p = prompt()) => {
  const onClose = vi.fn();
  const onPublish = vi.fn();
  render(<StageMilestoneDialog prompt={p} onClose={onClose} onPublish={onPublish} />);
  return { onClose, onPublish };
};

describe("StageMilestoneDialog: one question", () => {
  it("asks kindly, naming the project, with no pressure", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "That's a big step." })).toBeInTheDocument();
    expect(screen.getByText("Did you write THE END on A Fake Novel?")).toBeInTheDocument();
    expect(screen.getByText(STAGE_PROMPT.reassurance)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeEnabled();
    expect(answerStageMilestone).not.toHaveBeenCalled();
  });

  it("asks about publish-ready in its own words", () => {
    renderDialog(prompt({ kinds: ["publish_ready"] }));
    expect(screen.getByText("Is A Fake Novel ready to publish?")).toBeInTheDocument();
  });

  it("remembers 'Not yet', says it is fine, and closes on Done without asking again", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    expect(await screen.findByText(STAGE_PROMPT.notYetNote)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answerStageMilestone).toHaveBeenCalledTimes(1);
  });

  it("reuses the answer form (date, stories, share tick only with a story), saves a yes, and celebrates", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    expect(screen.getByLabelText(/When did it happen/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/And how does it feel now/), "Finally here.");
    const share = screen.getByRole("checkbox");
    expect(share).not.toBeChecked();
    await user.type(screen.getByLabelText(/When did it happen/), "2026-05-01");
    await user.click(screen.getByRole("button", { name: "Save it" }));
    await waitFor(() =>
      expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "yes", achievedOn: "2026-05-01", storyBefore: "", storyAfter: "Finally here.", shareStory: false, visibility: "public" }),
    );
    expect(await screen.findByTestId("stage-celebration")).toHaveTextContent(MILESTONE_CELEBRATION.the_end);
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Saved, so closing says nothing more.
    expect(answerStageMilestone).toHaveBeenCalledTimes(1);
  });

  it("saves a yes with nothing filled in (the date and stories are optional)", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    await user.click(screen.getByRole("button", { name: "Save it" }));
    await waitFor(() =>
      expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "yes", achievedOn: null, storyBefore: "", storyAfter: "", shareStory: false, visibility: "public" }),
    );
  });

  it("goes back to the question when the form is cancelled, and shows why a save failed", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Not yet" })).toBeInTheDocument();
    expect(answerStageMilestone).not.toHaveBeenCalled();

    vi.mocked(answerStageMilestone).mockResolvedValue({ error: "That date is still ahead of us." });
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    await user.click(screen.getByRole("button", { name: "Save it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That date is still ahead of us.");
  });

  it("shows why 'Not yet' failed and keeps the question open", async () => {
    vi.mocked(answerStageMilestone).mockResolvedValue({ error: "We couldn't save that. Please try again in a moment." });
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save that");
    expect(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end })).toBeInTheDocument();
  });

  it("counts closing it ('Close' or Escape) as 'not yet', so the question is not asked twice", async () => {
    const user = userEvent.setup();
    const first = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close for now" }));
    await waitFor(() => expect(first.onClose).toHaveBeenCalled());
    expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
  });

  it("counts Escape the same way", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
  });

  it("still closes when remembering the 'not yet' fails", async () => {
    vi.mocked(answerStageMilestone).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close for now" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("StageMilestoneDialog: both questions at once", () => {
  const both = prompt({ kinds: ["the_end", "publish_ready"] });

  it("asks them together as two steps, each answered on its own", async () => {
    const user = userEvent.setup();
    renderDialog(both);
    expect(screen.getByText("Did you write THE END, and is it ready to publish?")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(STAGE_PROMPT.step.the_end);
    expect(steps[1]).toHaveTextContent(STAGE_PROMPT.step.publish_ready);

    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    await user.click(screen.getByRole("button", { name: "Save it" }));
    await waitFor(() => expect(answerStageMilestone).toHaveBeenCalledWith(expect.objectContaining({ kind: "the_end", answer: "yes" })));
    expect(await screen.findByTestId("stage-celebration")).toHaveTextContent(MILESTONE_CELEBRATION.the_end);
    expect(screen.getByRole("button", { name: "Close for now" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "publish_ready", answer: "not_yet" }));
    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("on closing, remembers 'not yet' only for the step still open", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(both);
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.yes.the_end }));
    await user.click(screen.getByRole("button", { name: "Save it" }));
    await screen.findByTestId("stage-celebration");
    vi.mocked(answerStageMilestone).mockClear();
    await user.click(screen.getByRole("button", { name: "Close for now" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answerStageMilestone).toHaveBeenCalledTimes(1);
    expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "publish_ready", answer: "not_yet" });
  });
});

describe("StageMilestoneDialog: the Publish flow", () => {
  it("offers it on its own for a project that reached Complete with no book, with no question", async () => {
    const user = userEvent.setup();
    const { onPublish, onClose } = renderDialog(prompt({ kinds: [], offerPublish: true }));
    expect(screen.getByRole("dialog", { name: "Congratulations on finishing A Fake Novel." })).toBeInTheDocument();
    expect(screen.queryByText(/Did you write THE END/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.publishButton }));
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(answerStageMilestone).not.toHaveBeenCalled();
  });

  it("remembers 'not yet' for an open question before it hands over to the Publish flow", async () => {
    const user = userEvent.setup();
    const { onPublish } = renderDialog(prompt({ kinds: ["the_end"], offerPublish: true }));
    expect(screen.getByText("Did you write THE END on A Fake Novel?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: STAGE_PROMPT.publishButton }));
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    expect(answerStageMilestone).toHaveBeenCalledWith({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
  });
});

describe("the project page and the prompt", () => {
  const row = {
    id: PROJECT,
    title: "A Fake Novel",
    phase: "drafting",
    createdAt: "2026-01-01T00:00:00Z",
    showOnProfile: true,
    visibility: "community",
    coverUrl: null,
    description: null,
    startingBalances: {},
    totalsByMeasure: {},
    goals: [],
    book: null,
  } as unknown as WritingProjectRow;

  it("asks after the status saved, and keeps asking when the page below starts again on the new phase", async () => {
    vi.mocked(updateProjectPhase).mockResolvedValue({ success: true, milestonePrompt: prompt() });
    const user = userEvent.setup();
    const { rerender } = render(<ProjectDetailView viewKey="drafting:community" project={row} entries={[]} archivedGoals={[]} />);
    await user.selectOptions(screen.getByRole("combobox"), "first_read_through");
    expect(updateProjectPhase).toHaveBeenCalledWith(PROJECT, "first_read_through");
    expect(await screen.findByText("Did you write THE END on A Fake Novel?")).toBeInTheDocument();
    // The server's refreshed page arrives with the new phase: the page restarts, the question stays.
    rerender(<ProjectDetailView viewKey="first_read_through:community" project={{ ...row, phase: "first_read_through" }} entries={[]} archivedGoals={[]} />);
    expect(screen.getByText("Did you write THE END on A Fake Novel?")).toBeInTheDocument();
  });

  it("asks nothing when the status change asked for nothing, and not when it failed", async () => {
    vi.mocked(updateProjectPhase).mockResolvedValueOnce({ success: true });
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ProjectDetailView viewKey="drafting:community" project={row} entries={[]} archivedGoals={[]} />);
    await user.selectOptions(screen.getByRole("combobox"), "hibernating");
    await waitFor(() => expect(updateProjectPhase).toHaveBeenCalled());
    vi.mocked(updateProjectPhase).mockResolvedValueOnce({ error: "boom" });
    await user.selectOptions(screen.getByRole("combobox"), "revising");
    await waitFor(() => expect(updateProjectPhase).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the existing Publish flow when the dialog asks for it, and closes the dialog", async () => {
    vi.mocked(updateProjectPhase).mockResolvedValue({ success: true, milestonePrompt: prompt({ kinds: [], offerPublish: true }) });
    const user = userEvent.setup();
    render(<ProjectDetailView viewKey="publishing:community" project={{ ...row, phase: "publishing" }} entries={[]} archivedGoals={[]} />);
    expect(screen.queryByRole("dialog", { name: "Publish flow" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "complete");
    await user.click(await screen.findByRole("button", { name: STAGE_PROMPT.publishButton }));
    expect(await screen.findByRole("dialog", { name: "Publish flow" })).toBeInTheDocument();
    expect(screen.queryByText(/Congratulations on finishing/)).not.toBeInTheDocument();
  });

  it("works without a host: the page alone just changes the status", async () => {
    vi.mocked(updateProjectPhase).mockResolvedValue({ success: true, milestonePrompt: prompt() });
    const user = userEvent.setup();
    render(<ProjectDetailClient project={row} entries={[]} archivedGoals={[]} />);
    await user.selectOptions(screen.getByRole("combobox"), "revising");
    await waitFor(() => expect(updateProjectPhase).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
