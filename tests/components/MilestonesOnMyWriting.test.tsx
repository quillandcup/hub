// @vitest-environment jsdom
/**
 * Milestones live with each project in My Writing (docs/product/FINISHERS.md): a closed row on each project card, a section on the
 * project's own page, "Other works" for everything that is not a project, a summary line, and only a pointer left in Settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";
import * as actions from "@/app/(member)/settings/milestoneActions";
import {
  MILESTONES_INTRO,
  MilestoneSummary,
  OtherWorks,
  ProjectMilestonesSection,
  ProjectMilestonesToggle,
  milestoneProgressWords,
} from "@/components/writing/Milestones";
import { buildWorks } from "@/lib/finishers-works";
import { PUBLISHED_ROW_HEADING, milestoneRowHeading } from "@/lib/finishers";
import type { Milestone } from "@/lib/data/milestones";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/app/(member)/projects/actions", () => ({}));
vi.mock("@/components/writing/NewProjectModal", () => ({ default: () => null }));
vi.mock("@/components/writing/TrackbearImportModal", () => ({ default: () => null }));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));
vi.mock("@/app/(member)/projects/PastProjects", () => ({ default: () => null }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({
  answerMilestone: vi.fn(),
  addMilestone: vi.fn(),
  takeBackMilestone: vi.fn(),
  setMilestoneVisibility: vi.fn(),
  setMilestoneShare: vi.fn(),
  setMilestonePhotoAlt: vi.fn(),
}));

const NOVEL = { id: "wpr_NOVEL", title: "A Fake Novel", phase: "revising" };
const SECOND = { id: "wpr_SECOND", title: "A Second Fake Project", phase: "drafting" };

const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  projectId: NOVEL.id,
  bookId: null,
  title: null,
  status: "confirmed",
  source: "member",
  achievedOn: null,
  achievedPrecision: "day",
  storyBefore: null,
  storyAfter: null,
  visibility: "public",
  consentTestimonial: false,
  photo: null,
  confirmedAt: "2026-11-20T12:00:00Z",
  createdAt: "2026-11-20T12:00:00Z",
  ...overrides,
});

const row = (p: { id: string; title: string; phase: string }) =>
  ({ ...p, createdAt: "2026-01-01T00:00:00Z", showOnProfile: true, visibility: "community", coverUrl: null, description: null, startingBalances: {}, totalsByMeasure: {}, goals: [], book: null }) as unknown as WritingProjectRow;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const workOf = (milestones: Milestone[], books: { id: string; title: string; projectId: string | null; publishedDate?: string }[] = []) =>
  buildWorks([NOVEL, SECOND], books, milestones).find((w) => w.projectId === NOVEL.id)!;

describe("a project card's milestones", () => {
  it("is a closed row that says how far the work has got, and opens to that project's steps", async () => {
    const user = userEvent.setup();
    render(<ProjectMilestonesToggle work={workOf([milestone()])} />);
    const toggle = screen.getByRole("button", { name: /Milestones/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("1 of 3 reached");
    expect(screen.queryByText(milestoneRowHeading("the_end"))).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The same presentation as before: THE END with its date line, the globe control, Change and Take it back; publish-ready to add.
    expect(screen.getByText(milestoneRowHeading("the_end"))).toBeInTheDocument();
    expect(screen.getByText(milestoneRowHeading("publish_ready"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Who can see this milestone: Everyone/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take it back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My manuscript is publish-ready" })).toBeEnabled();
    await user.click(toggle);
    expect(screen.queryByText(milestoneRowHeading("the_end"))).not.toBeInTheDocument();
  });

  it("shows a step staff proposed as waiting for the member, on the closed row and when opened", async () => {
    const user = userEvent.setup();
    render(<ProjectMilestonesToggle work={workOf([milestone({ status: "proposed", source: "staff", visibility: "private", confirmedAt: null })])} />);
    expect(screen.getByRole("button", { name: /Milestones/ })).toHaveTextContent("0 of 3 reached · 1 waiting for you to confirm");
    await user.click(screen.getByRole("button", { name: /Milestones/ }));
    expect(screen.getByText(/Waiting for you to confirm/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, this is me" })).toBeEnabled();
  });

  it("counts a book on the Bookshelf as the third step, read-only", async () => {
    const user = userEvent.setup();
    const work = workOf([milestone()], [{ id: "book_1", title: "A Fake Book", projectId: NOVEL.id, publishedDate: "2026-06-01" }]);
    expect(milestoneProgressWords(work)).toBe("2 of 3 reached");
    render(<ProjectMilestonesToggle work={work} />);
    await user.click(screen.getByRole("button", { name: /Milestones/ }));
    expect(screen.getByText(PUBLISHED_ROW_HEADING)).toBeInTheDocument();
  });

  it("is look-only while an admin views as the member", async () => {
    const user = userEvent.setup();
    render(<ProjectMilestonesToggle work={workOf([])} readOnly />);
    await user.click(screen.getByRole("button", { name: /Milestones/ }));
    expect(screen.getByRole("button", { name: "I wrote THE END" })).toBeDisabled();
  });
});

describe("a project's own page", () => {
  it("has a Milestones section, anchored for the prompt's link, with the same rows and who sees them", () => {
    render(<ProjectMilestonesSection work={workOf([milestone()])} web={{ available: true, on: true }} />);
    const section = screen.getByTestId("project-milestones-section");
    expect(section).toHaveAttribute("id", "milestones");
    expect(within(section).getByRole("heading", { name: "Milestones" })).toBeInTheDocument();
    expect(section).toHaveTextContent(MILESTONES_INTRO);
    expect(within(section).getByText(milestoneRowHeading("the_end"))).toBeInTheDocument();
  });
});

describe("Other works", () => {
  it("is always there, with the add button, and lists works that are not projects", () => {
    const { rerender } = render(<OtherWorks works={[]} />);
    expect(screen.getByRole("heading", { name: "Other works" })).toHaveAttribute("id", "other-works");
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeEnabled();
    const works = buildWorks([NOVEL], [{ id: "book_loose", title: "A Loose Fake Book", projectId: null, publishedDate: "2026-06-01" }], [milestone({ id: "m2", projectId: null, title: "A Fake Memoir" })]);
    rerender(<OtherWorks works={works.filter((w) => w.projectId !== NOVEL.id)} />);
    expect(screen.getByRole("heading", { name: "A Loose Fake Book" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Fake Memoir" })).toBeInTheDocument();
  });

  it("adds a milestone for a work that is not listed, by title", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<OtherWorks works={[]} />);
    await user.click(screen.getByRole("button", { name: "Add a work that is not listed here" }));
    await user.type(screen.getByLabelText("What is it called?"), "A Fake Memoir");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledWith(expect.objectContaining({ kind: "the_end", title: "A Fake Memoir" })));
  });
});

describe("the summary line", () => {
  it("says where the works stand, and leaves its anchor even when there is nothing to say", () => {
    const { container, rerender } = render(<MilestoneSummary works={[]} waiting={false} />);
    expect(container.querySelector("#your-milestones")).toBeInTheDocument();
    expect(screen.queryByTestId("milestone-summary")).not.toBeInTheDocument();
    rerender(<MilestoneSummary works={buildWorks([NOVEL], [], [milestone()])} waiting />);
    expect(screen.getByTestId("milestone-summary")).toHaveTextContent("1 work · 1 finished");
    expect(screen.getByText(/may have reached a milestone already/)).toBeInTheDocument();
  });
});

describe("My Writing's Projects tab", () => {
  it("puts each project's milestones on its card, and every other work under Other works", async () => {
    const user = userEvent.setup();
    const works = buildWorks(
      [NOVEL, SECOND],
      [{ id: "book_loose", title: "A Loose Fake Book", projectId: null, publishedDate: "2026-06-01" }],
      [milestone(), milestone({ id: "m2", projectId: null, title: "A Fake Memoir" })],
    );
    render(<ProjectsClient initialProjects={[row(NOVEL), row(SECOND)]} works={works} />);
    const cards = screen.getAllByTestId("project-milestones");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("1 of 3 reached");
    expect(cards[1]).toHaveTextContent("0 of 3 reached");
    expect(screen.getByTestId("milestone-summary")).toHaveTextContent("3 works · 1 published · 2 finished");
    // Only works that are not a project are listed under Other works: the project's own steps are not repeated there.
    const other = screen.getByRole("heading", { name: "Other works" }).closest("section") as HTMLElement;
    expect(within(other).getByRole("heading", { name: "A Loose Fake Book" })).toBeInTheDocument();
    expect(within(other).getByRole("heading", { name: "A Fake Memoir" })).toBeInTheDocument();
    expect(within(other).queryByText("A Fake Novel")).not.toBeInTheDocument();
    await user.click(within(cards[0]).getByRole("button", { name: /Milestones/ }));
    expect(within(cards[0]).getByText(milestoneRowHeading("the_end"))).toBeInTheDocument();
  });

  it("still offers Other works to a member with no projects yet", () => {
    render(<ProjectsClient initialProjects={[]} works={[]} />);
    expect(screen.getByRole("heading", { name: "Other works" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeEnabled();
  });

  it("is look-only in sudo", () => {
    render(<ProjectsClient initialProjects={[]} works={[]} readOnly />);
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeDisabled();
  });
});
