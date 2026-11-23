// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MilestoneSummary, OtherWorks, ProjectMilestones, type MilestoneWebState } from "@/components/writing/Milestones";
import { buildWorks, otherWorks, workOfProject, type CardBook, type CardProject } from "@/lib/finishers-works";
import * as actions from "@/app/(member)/settings/milestoneActions";
import { MILESTONE_DEFAULT_VISIBILITY, MILESTONE_LEVEL_LINES, MILESTONE_CELEBRATION, MILESTONE_LABELS, MILESTONE_SELF_ADD, PUBLISHED_ROW_HEADING, milestoneRowHeading, SHARE_STORY_LABEL, SHARE_STORY_TIP } from "@/lib/finishers";
import type { Milestone } from "@/lib/data/milestones";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({
  answerMilestone: vi.fn(),
  addMilestone: vi.fn(),
  takeBackMilestone: vi.fn(),
  setMilestoneVisibility: vi.fn(),
  setMilestoneShare: vi.fn(),
  setMilestonePhotoAlt: vi.fn(),
}));

const NOVEL = { id: "wpr_NOVEL", title: "A Fake Novel", phase: "revising" };
const DRAFT = { id: "wpr_DRAFT", title: "A Fake Draft", phase: "drafting" };

const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  projectId: NOVEL.id,
  bookId: null,
  title: null,
  status: "proposed",
  source: "staff",
  achievedOn: null,
  achievedPrecision: "day",
  storyBefore: null,
  storyAfter: null,
  visibility: "private",
  consentTestimonial: false,
  photo: null,
  confirmedAt: null,
  createdAt: "2026-11-20T12:00:00Z",
  ...overrides,
});


/**
 * The milestones as My Writing lays them out, flattened for these tests: each project's own steps (its card opens them, tested
 * apart in MilestonesOnMyWriting.test.tsx), the summary line, and "Other works".
 */
function MilestonesPanel({
  milestones,
  projects = [],
  books = [],
  firstJoinedAt = null,
  readOnly = false,
  web = { available: false, on: false },
}: {
  milestones: Milestone[];
  projects?: CardProject[];
  books?: CardBook[];
  firstJoinedAt?: string | null;
  readOnly?: boolean;
  web?: MilestoneWebState;
}) {
  const works = buildWorks(projects, books, milestones, firstJoinedAt);
  const active = new Set(projects.map((p) => p.id));
  return (
    <div>
      <MilestoneSummary works={works} waiting={milestones.some((m) => m.status === "proposed")} />
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <h3>{p.title}</h3>
            <ProjectMilestones work={workOfProject(works, p.id)!} readOnly={readOnly} web={web} />
          </li>
        ))}
      </ul>
      <OtherWorks works={otherWorks(works, active)} readOnly={readOnly} web={web} />
    </div>
  );
}

const work = (title: string) => screen.getByRole("heading", { name: title }).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MilestonesPanel (per work)", () => {
  it("always offers a work that is not listed, even with no works, and says nothing in the summary", () => {
    render(<MilestonesPanel milestones={[]} />);
    expect(screen.getByRole("heading", { name: "Other works" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeEnabled();
    expect(screen.queryByTestId("milestone-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the Bookshelf" })).toHaveAttribute("href", "/bookshelf");
  });

  it("lists each work with its own rows and states, titles from src/lib/finishers.ts", () => {
    render(
      <MilestonesPanel
        milestones={[milestone({ status: "confirmed", source: "member", achievedOn: "2026-05-01", confirmedAt: "2026-11-21" }), milestone({ id: "mlst_2", kind: "publish_ready" })]}
        projects={[NOVEL]}
      />,
    );
    const li = within(work("A Fake Novel"));
    expect(li.getByText(/Confirmed \(May 1, 2026\)/)).toBeInTheDocument();
    expect(li.getByText(/Waiting for you to confirm/)).toBeInTheDocument();
    expect(li.getByText(milestoneRowHeading("the_end"))).toBeInTheDocument();
    expect(li.getByText(milestoneRowHeading("publish_ready"))).toBeInTheDocument();
    expect(li.queryByText(PUBLISHED_ROW_HEADING)).not.toBeInTheDocument();
  });

  it("shows a book as a work with Published read-only, once when it is also a project", () => {
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} books={[{ id: "book_1", title: "Its Book", projectId: NOVEL.id }, { id: "book_2", title: "A Loose Book", projectId: null }]} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["A Fake Novel", "A Loose Book"]);
    for (const title of ["A Fake Novel", "A Loose Book"]) {
      expect(within(work(title)).getByText(PUBLISHED_ROW_HEADING)).toBeInTheDocument();
      expect(within(work(title)).getByRole("link", { name: "See your Bookshelf" })).toHaveAttribute("href", "/bookshelf");
    }
  });

  it("lists a book from before the member joined as a work without Published, and says why", () => {
    render(
      <MilestonesPanel
        milestones={[]}
        books={[{ id: "book_1", title: "An Earlier Fake Book", projectId: null, publishedDate: "2026-02-28" }, { id: "book_2", title: "A Later Fake Book", projectId: null, publishedDate: "2026-03-01" }]}
        firstJoinedAt="2026-03-01T15:00:00Z"
      />,
    );
    expect(screen.getByTestId("milestone-summary")).toHaveTextContent("1 work · 1 published");
    expect(screen.getByText(/came out since you joined the community. Earlier books stay on your Bookshelf but are not counted here/)).toBeInTheDocument();
  });

  it("sums up where the works stand in plain counts, with no title words", () => {
    render(
      <MilestonesPanel
        milestones={[
          milestone({ id: "m1", status: "confirmed", confirmedAt: "x" }),
          milestone({ id: "m2", projectId: "wpr_TWO", status: "confirmed", confirmedAt: "x" }),
          milestone({ id: "m3", projectId: "wpr_TWO", kind: "publish_ready", status: "confirmed", confirmedAt: "x" }),
          milestone({ id: "m4", projectId: "wpr_THREE", status: "proposed" }),
        ]}
        projects={[NOVEL, { id: "wpr_TWO", title: "Two", phase: "revising" }, { id: "wpr_THREE", title: "Three", phase: "revising" }]}
        books={[{ id: "book_1", title: "A Loose Book", projectId: null }]}
      />,
    );
    expect(screen.getByTestId("milestone-summary")).toHaveTextContent("3 works · 1 published · 1 ready to publish · 1 finished");
  });

  it("adds THE END for one work: sends that work, with the share tick unticked unless ticked", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} books={[{ id: "book_1", title: "Its Book", projectId: NOVEL.id }]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
    // No story yet, so nothing to share: the tick is not on the form at all.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("The day"), "2026-05-01");
    await user.type(screen.getByLabelText(/how does it feel now/i), "Done.");
    // It appears with the story, with the wording, and starts unticked; the promises sit behind the info icon, not under every work.
    const tick = screen.getByRole("checkbox", { name: SHARE_STORY_LABEL });
    expect(tick).not.toBeChecked();
    expect(screen.getByRole("tooltip")).toHaveTextContent(SHARE_STORY_TIP);
    expect(screen.getAllByText(SHARE_STORY_TIP)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "What sharing my story means" })).toBeInTheDocument();
    await user.click(tick);
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(1));
    expect(actions.addMilestone).toHaveBeenCalledWith({
      kind: "the_end",
      projectId: NOVEL.id,
      bookId: "book_1",
      title: null,
      achievedOn: "2026-05-01",
      achievedPrecision: "day",
      storyBefore: "",
      storyAfter: "Done.",
      shareStory: true,
      visibility: "public",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows who will see a milestone beside the story fields, starting at the globe, and sends the level the member picks", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
    const field = screen.getByTestId("milestone-form-level");
    // The default is a visible, one-click choice, with a plain line about who will see it.
    expect(MILESTONE_DEFAULT_VISIBILITY).toBe("public");
    expect(within(field).getByRole("button", { name: "Who can see this milestone: Everyone" })).toBeInTheDocument();
    expect(screen.getByTestId("milestone-form-level-line")).toHaveTextContent("Anyone on the internet, once your writer profile is on; members see it now.");
    // One click moves on to the lock, then the house; the line follows.
    await user.click(within(field).getByRole("button", { name: /Who can see this milestone/ }));
    expect(screen.getByTestId("milestone-form-level-line")).toHaveTextContent(MILESTONE_LEVEL_LINES.private);
    await user.click(within(field).getByRole("button", { name: /Who can see this milestone/ }));
    expect(screen.getByTestId("milestone-form-level-line")).toHaveTextContent(MILESTONE_LEVEL_LINES.community);
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(1));
    expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ kind: "the_end", visibility: "community" }));
  });

  it("starts the form of a milestone already confirmed at its own level, not the default", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", source: "member", confirmedAt: "x", visibility: "private" })]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(within(screen.getByTestId("milestone-form-level")).getByRole("button", { name: "Who can see this milestone: Only me" })).toBeInTheDocument();
    expect(screen.getByTestId("milestone-form-level-line")).toHaveTextContent(MILESTONE_LEVEL_LINES.private);
  });

  it("adds publish-ready for a work with nothing filled in, and shows why a failure failed", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValueOnce({ error: "That date is still ahead of us." }).mockResolvedValueOnce({ success: true, added: false });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button }));
    await user.click(screen.getByRole("button", { name: "Add it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That date is still ahead of us.");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actions.addMilestone).mock.calls[1][0]).toMatchObject({ kind: "publish_ready", projectId: NOVEL.id, bookId: null, title: null });
  });

  it("adds a work that is not listed here, by title and milestone", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} />);
    await user.click(screen.getByRole("button", { name: "Add a work that is not listed here" }));
    await user.type(screen.getByLabelText("What is it called?"), "A Fake Memoir");
    await user.selectOptions(screen.getByLabelText("Which step did you reach?"), "publish_ready");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(1));
    expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ kind: "publish_ready", title: "A Fake Memoir" }));
    expect(vi.mocked(actions.addMilestone).mock.calls[0][0]).not.toHaveProperty("projectId");
  });

  it("lists a work added by title with its milestones, and adds the other kind for it by title", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ projectId: null, title: "A Fake Memoir", status: "confirmed", source: "member", confirmedAt: "x" })]} />);
    await user.click(within(work("A Fake Memoir")).getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button }));
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalled());
    expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ kind: "publish_ready", projectId: null, bookId: null, title: "A Fake Memoir" }));
  });

  it("shows a row from before works existed under its own heading", () => {
    render(<MilestonesPanel milestones={[milestone({ projectId: null })]} />);
    expect(screen.getByRole("heading", { name: "Not linked to a work" })).toBeInTheDocument();
  });

  it("takes back a milestone the member added only after a confirmation", async () => {
    vi.mocked(actions.takeBackMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", source: "member", confirmedAt: "2026-11-21" })]} projects={[NOVEL]} />);
    expect(screen.queryByRole("button", { name: "Not me / not yet" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take it back" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(`Take back ${MILESTONE_LABELS.the_end}?`);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.takeBackMilestone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Take it back" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(actions.takeBackMilestone).toHaveBeenCalledWith("mlst_AAAAAAAAAAA1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("lets the member take back one they confirmed from the project prompt, and shows a 'not yet' from it as a no that can be undone", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MilestonesPanel milestones={[milestone({ status: "confirmed", source: "project_stage", confirmedAt: "2026-11-21" })]} projects={[NOVEL]} />);
    expect(screen.getByRole("button", { name: "Take it back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not me / not yet" })).not.toBeInTheDocument();
    unmount();
    render(<MilestonesPanel milestones={[milestone({ status: "declined", source: "project_stage" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/You said no, or not yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actually, it is me" }));
    expect(screen.getByLabelText(/before you got here/)).toBeInTheDocument();
  });

  it("shows why a take-back failed", async () => {
    vi.mocked(actions.takeBackMilestone).mockResolvedValue({ error: "We couldn't find that milestone." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", source: "member", confirmedAt: "x" })]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Take it back" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find that milestone.");
  });

  it("asks about a staff proposal in plain words, confirms with a form and declines in one click", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} projects={[NOVEL]} />);
    expect(screen.getByText(/Suggested by the Quill & Cup team/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/before you got here/), "Stuck in chapter two.");
    expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledTimes(1));
    expect(actions.answerMilestone).toHaveBeenCalledWith({
      id: "mlst_AAAAAAAAAAA1",
      answer: "confirm",
      achievedOn: null,
      achievedPrecision: "day",
      storyBefore: "Stuck in chapter two.",
      storyAfter: "",
      shareStory: false,
      visibility: "public",
    });
  });

  it("declines a proposal with one click and no form", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Not me / not yet" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledWith({ id: "mlst_AAAAAAAAAAA1", answer: "decline" }));
  });

  it("shows a confirmed milestone's share tick as the member left it, and lets them change it", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x", storyAfter: "At last.", consentTestimonial: true })]} projects={[NOVEL]} />);
    expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getAllByRole("checkbox", { name: SHARE_STORY_LABEL })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).toBeChecked();
  });

  it("reopens a declined milestone", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "declined" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/It isn.t shown anywhere/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actually, it is me" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("is look-only while an admin views as the member", () => {
    render(<MilestonesPanel milestones={[milestone(), milestone({ id: "m2", kind: "publish_ready", projectId: NOVEL.id, status: "declined" })]} projects={[NOVEL]} readOnly />);
    expect(screen.getByRole("button", { name: "Yes, this is me" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not me / not yet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeDisabled();
    expect(screen.getByText(/viewing as this member/)).toBeInTheDocument();
  });
});

const confirmed = (overrides: Partial<Milestone> = {}) => milestone({ status: "confirmed", source: "member", confirmedAt: "2026-11-20T12:00:00Z", visibility: "community", ...overrides });

describe("MilestonesPanel (who sees it, and the share tick)", () => {
  it("shows the control on a confirmed milestone only, never on a proposal, a declined one or an empty row", () => {
    render(<MilestonesPanel milestones={[confirmed(), milestone({ id: "m2", kind: "publish_ready" })]} projects={[NOVEL]} />);
    expect(screen.getAllByRole("button", { name: /Who can see this milestone/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Who can see this milestone: Other members" })).toBeInTheDocument();
  });

  it("cycles lock, house, and only offers the globe when writer profiles are open", async () => {
    vi.mocked(actions.setMilestoneVisibility).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { unmount } = render(<MilestonesPanel milestones={[confirmed()]} projects={[NOVEL]} web={{ available: false, on: false }} />);
    // house -> (no globe) -> lock
    await user.click(screen.getByRole("button", { name: /Who can see this milestone/ }));
    expect(actions.setMilestoneVisibility).toHaveBeenLastCalledWith("mlst_AAAAAAAAAAA1", "private");
    await waitFor(() => expect(screen.getByRole("button", { name: "Who can see this milestone: Only me" })).toBeInTheDocument());
    unmount();
    render(<MilestonesPanel milestones={[confirmed()]} projects={[NOVEL]} web={{ available: true, on: true }} />);
    await user.click(screen.getByRole("button", { name: /Who can see this milestone/ }));
    expect(actions.setMilestoneVisibility).toHaveBeenLastCalledWith("mlst_AAAAAAAAAAA1", "public");
  });

  it("goes back and says why when the level cannot be saved", async () => {
    vi.mocked(actions.setMilestoneVisibility).mockResolvedValue({ error: "Writer profiles are not open to you yet." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[confirmed()]} projects={[NOVEL]} web={{ available: true, on: true }} />);
    await user.click(screen.getByRole("button", { name: /Who can see this milestone/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Writer profiles are not open to you yet.");
    expect(screen.getByRole("button", { name: "Who can see this milestone: Other members" })).toBeInTheDocument();
  });

  it("says what the globe does right now when the profile is off or not open", () => {
    const { rerender } = render(<MilestonesPanel milestones={[confirmed({ visibility: "public" })]} projects={[NOVEL]} web={{ available: true, on: false }} />);
    expect(screen.getByTestId("milestone-web-note")).toHaveTextContent(/once your writer profile is on/);
    rerender(<MilestonesPanel milestones={[confirmed({ visibility: "public" })]} projects={[NOVEL]} web={{ available: false, on: false }} />);
    expect(screen.getByTestId("milestone-web-note")).toHaveTextContent(/not open to you yet/);
    rerender(<MilestonesPanel milestones={[confirmed({ visibility: "public" })]} projects={[NOVEL]} web={{ available: true, on: true }} />);
    expect(screen.queryByTestId("milestone-web-note")).not.toBeInTheDocument();
  });

  it("is look-only for the control and the tick while an admin views as the member", () => {
    render(<MilestonesPanel milestones={[confirmed({ storyAfter: "Done." })]} projects={[NOVEL]} readOnly />);
    expect(screen.getByRole("button", { name: /Who can see this milestone/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).toBeDisabled();
  });

  it("shows no share tick on a confirmed milestone without a story", () => {
    render(<MilestonesPanel milestones={[confirmed()]} projects={[NOVEL]} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("withdraws the share tick on the card, with no warning, and puts it back if that fails", async () => {
    vi.mocked(actions.setMilestoneShare).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ error: "We couldn't save that." });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[confirmed({ storyAfter: "Done.", consentTestimonial: true })]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL }));
    expect(actions.setMilestoneShare).toHaveBeenLastCalledWith("mlst_AAAAAAAAAAA1", false);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).not.toBeChecked());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save that.");
    expect(screen.getByRole("checkbox", { name: SHARE_STORY_LABEL })).not.toBeChecked();
  });

  it("celebrates THE END after it is confirmed, and a plain line for publish-ready, before anything else", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    // The server's next render has the milestone confirmed; stand in for it by re-rendering after the save.
    const { rerender } = render(<MilestonesPanel milestones={[milestone()]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalled());
    rerender(<MilestonesPanel milestones={[confirmed({ source: "staff" })]} projects={[NOVEL]} />);
    expect(await screen.findByTestId("milestone-celebration")).toHaveTextContent(MILESTONE_CELEBRATION.the_end);
    expect(MILESTONE_CELEBRATION.the_end).toBe("You wrote THE END. We're so proud of you.");
  });

  it("celebrates publish-ready with its own line, and not after a plain change of a confirmed one", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender } = render(<MilestonesPanel milestones={[]} projects={[NOVEL]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.publish_ready.button }));
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalled());
    rerender(<MilestonesPanel milestones={[confirmed({ kind: "publish_ready" })]} projects={[NOVEL]} />);
    expect(await screen.findByTestId("milestone-celebration")).toHaveTextContent(MILESTONE_CELEBRATION.publish_ready);

    // Changing a milestone that was already confirmed does not celebrate again.
    rerender(<MilestonesPanel milestones={[confirmed()]} projects={[{ ...NOVEL, id: "wpr_OTHER", title: "Another Fake Novel" }]} />);
    await user.click(screen.getAllByRole("button", { name: "Change" })[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalled());
    expect(screen.queryByTestId("milestone-celebration")).not.toBeInTheDocument();
  });
});


describe("MilestonesPanel (approximate dates)", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
  };

  it("offers a day, a month and year, a year, or I don't remember, starting at the day", async () => {
    const user = userEvent.setup();
    await open(user);
    const when = screen.getByLabelText(/When did it happen/);
    expect(Array.from((when as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["A day", "Month and year", "Year only", "I don't remember"]);
    expect(when).toHaveValue("day");
    expect(screen.getByLabelText("The day")).toHaveAttribute("type", "date");
  });

  it("sends a month as the month it is, with its precision", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.selectOptions(screen.getByLabelText(/When did it happen/), "month");
    expect(screen.getByLabelText("The month")).toHaveAttribute("type", "month");
    await user.type(screen.getByLabelText("The month"), "2026-05");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ achievedOn: "2026-05", achievedPrecision: "month" })));
  });

  it("sends a year as four digits, ignoring anything else typed", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.selectOptions(screen.getByLabelText(/When did it happen/), "year");
    await user.type(screen.getByLabelText("The year"), "20a24");
    expect(screen.getByLabelText("The year")).toHaveValue("2024");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ achievedOn: "2024", achievedPrecision: "year" })));
  });

  it("sends no date for I don't remember, and says that is fine", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText("The day"), "2026-05-01");
    await user.selectOptions(screen.getByLabelText(/When did it happen/), "none");
    expect(screen.queryByLabelText("The day")).not.toBeInTheDocument();
    expect(screen.getByText(/will show with no date/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ achievedOn: null, achievedPrecision: "day" })));
  });

  it("leaving the date empty is allowed: the answer is asked for, never required", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ achievedOn: null, achievedPrecision: "day" })));
  });

  it("shows a stored month or year as it was given, and opens its form on the same precision", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x", source: "member", achievedOn: "2026-05-01", achievedPrecision: "month" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/Confirmed \(May 2026\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText(/When did it happen/)).toHaveValue("month");
    expect(screen.getByLabelText("The month")).toHaveValue("2026-05");
    unmount();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x", source: "member", achievedOn: "2024-01-01", achievedPrecision: "year" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/Confirmed \(2024\)/)).toBeInTheDocument();
  });

  it("opens a confirmed milestone with no date on I don't remember, and a proposal on the day", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x", source: "member" })]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText(/When did it happen/)).toHaveValue("none");
    unmount();
    render(<MilestonesPanel milestones={[milestone()]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    expect(screen.getByLabelText(/When did it happen/)).toHaveValue("day");
  });
});

describe("MilestonesPanel (photos)", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const confirmedAt = (visibility: Milestone["visibility"], extra: Partial<Milestone> = {}) => milestone({ status: "confirmed", source: "member", confirmedAt: "2026-11-21", visibility, ...extra });

  it("offers a photo on each confirmed step, in the step's own words, and none on a step not confirmed", () => {
    render(<MilestonesPanel milestones={[confirmedAt("community"), milestone({ id: "mlst_2", kind: "publish_ready" })]} projects={[NOVEL]} />);
    const li = within(work("A Fake Novel"));
    expect(li.getAllByRole("button", { name: "Add a photo" })).toHaveLength(1);
    expect(li.getByText("A photo from the day you wrote THE END, if you have one.")).toBeInTheDocument();
  });

  it("says who can see the photo at each level, the same as the milestone, and never more than will happen", () => {
    const { rerender } = render(<MilestonesPanel milestones={[confirmedAt("private")]} projects={[NOVEL]} />);
    expect(screen.getByTestId("milestone-photo-line")).toHaveTextContent("Only you can see this photo");
    rerender(<MilestonesPanel milestones={[confirmedAt("community")]} projects={[NOVEL]} />);
    expect(screen.getByTestId("milestone-photo-line")).toHaveTextContent("Other members can see this photo on your profile");
    rerender(<MilestonesPanel milestones={[confirmedAt("public")]} projects={[NOVEL]} web={{ available: true, on: false }} />);
    expect(screen.getByTestId("milestone-photo-line")).toHaveTextContent("goes on the web once your writer profile is on");
    rerender(<MilestonesPanel milestones={[confirmedAt("public")]} projects={[NOVEL]} web={{ available: true, on: true }} />);
    expect(screen.getByTestId("milestone-photo-line")).toHaveTextContent("Anyone on the internet can see this photo");
  });

  it("shows the photo that is there, and offers the share tick for a milestone that has a photo and no story", () => {
    render(<MilestonesPanel milestones={[confirmedAt("community", { photo: { token: TOKEN, alt: "Me at my desk" } })]} projects={[NOVEL]} />);
    expect(screen.getByRole("img", { name: "Me at my desk" })).toHaveAttribute("src", `/api/milestone-photos/${TOKEN}`);
    expect(screen.getByLabelText(SHARE_STORY_LABEL)).toBeInTheDocument();
  });

  it("offers no share tick for a milestone with neither a story nor a photo", () => {
    render(<MilestonesPanel milestones={[confirmedAt("community")]} projects={[NOVEL]} />);
    expect(screen.queryByLabelText(SHARE_STORY_LABEL)).not.toBeInTheDocument();
  });

  it("puts the 'holding my book' photo on the Published step of a Bookshelf book, at the globe", () => {
    render(
      <MilestonesPanel
        milestones={[]}
        books={[{ id: "book_1", title: "A Loose Book", projectId: null, photo: { token: TOKEN, alt: "Holding it" } }, { id: "book_2", title: "Another Loose Book", projectId: null }]}
        web={{ available: true, on: true }}
      />,
    );
    const first = within(work("A Loose Book"));
    expect(first.getByRole("img", { name: "Holding it" })).toHaveAttribute("src", `/api/milestone-photos/${TOKEN}`);
    expect(first.getByTestId("milestone-photo-line")).toHaveTextContent("Anyone on the internet can see this photo");
    const second = within(work("Another Loose Book"));
    expect(second.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
    expect(second.getByText("A photo of you holding your book, printed or on a Kindle, if you have one.")).toBeInTheDocument();
    expect(second.queryByRole("img")).not.toBeInTheDocument();
  });

  it("is look-only when staff view as the member", () => {
    render(<MilestonesPanel milestones={[confirmedAt("community", { photo: { token: TOKEN, alt: null } })]} projects={[NOVEL]} readOnly />);
    expect(screen.getByRole("button", { name: "Change photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeDisabled();
  });
});
