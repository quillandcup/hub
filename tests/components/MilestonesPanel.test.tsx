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
  storyBefore: null,
  storyAfter: null,
  consentProfile: false,
  consentHomepage: false,
  consentTestimonial: false,
  confirmedAt: null,
  createdAt: "2026-11-20T12:00:00Z",
  ...overrides,
});

const work = (title: string) => screen.getByRole("heading", { name: title }).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MilestonesPanel (per work)", () => {
  it("is always there, even with no works, and offers a work that is not listed", () => {
    render(<MilestonesPanel milestones={[]} />);
    expect(screen.getByRole("heading", { name: "Your milestones" })).toBeInTheDocument();
    expect(screen.getByText(/no projects or books yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeEnabled();
    expect(screen.queryByTestId("milestone-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the Bookshelf" })).toHaveAttribute("href", "/bookshelf");
  });

  it("lists each work with its own rows and states, titles from lib/finishers.ts", () => {
    render(
      <MilestonesPanel
        milestones={[milestone({ status: "confirmed", source: "member", achievedOn: "2026-05-01", confirmedAt: "2026-11-21" }), milestone({ id: "mlst_2", kind: "publish_ready" })]}
        projects={[NOVEL]}
      />,
    );
    const li = within(work("A Fake Novel"));
    expect(li.getByText(/Confirmed \(May 1, 2026\)/)).toBeInTheDocument();
    expect(li.getByText(/Waiting for you to confirm/)).toBeInTheDocument();
    expect(li.getByText(new RegExp(`${MILESTONE_TITLES.the_end}, ${MILESTONE_LABELS.the_end}`))).toBeInTheDocument();
    expect(li.getByText(new RegExp(`${MILESTONE_TITLES.publish_ready}, ${MILESTONE_LABELS.publish_ready}`))).toBeInTheDocument();
    expect(li.queryByText(new RegExp(PUBLISHED_TITLE))).not.toBeInTheDocument();
  });

  it("shows works that have a milestone or are past drafting first, and the rest under 'Show all my projects'", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[NOVEL, DRAFT]} />);
    expect(screen.getByRole("heading", { name: "A Fake Novel" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A Fake Draft" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all my projects (1 more)" }));
    expect(screen.getByRole("heading", { name: "A Fake Draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all my projects/ })).not.toBeInTheDocument();
  });

  it("brings a drafting project up front once it has a milestone", () => {
    render(<MilestonesPanel milestones={[milestone({ projectId: DRAFT.id })]} projects={[DRAFT]} />);
    expect(screen.getByRole("heading", { name: "A Fake Draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all my projects/ })).not.toBeInTheDocument();
  });

  it("shows a book as a work with Published read-only, once when it is also a project", () => {
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} books={[{ id: "book_1", title: "Its Book", projectId: NOVEL.id }, { id: "book_2", title: "A Loose Book", projectId: null }]} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["A Fake Novel", "A Loose Book"]);
    for (const title of ["A Fake Novel", "A Loose Book"]) {
      expect(within(work(title)).getByText(new RegExp(PUBLISHED_TITLE))).toBeInTheDocument();
      expect(within(work(title)).getByRole("link", { name: "See your Bookshelf" })).toHaveAttribute("href", "/bookshelf");
    }
  });

  it("sums up the titles from the whole set in plain words, Author only for publish-ready works", () => {
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
    expect(screen.getByTestId("milestone-summary")).toHaveTextContent("Published Author of 1 work · Author of 1 work · Finisher of 1 work");
  });

  it("adds THE END for one work: sends that work, with every consent unticked unless ticked", async () => {
    vi.mocked(actions.addMilestone).mockResolvedValue({ success: true, added: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[]} projects={[NOVEL]} books={[{ id: "book_1", title: "Its Book", projectId: NOVEL.id }]} />);
    await user.click(within(work("A Fake Novel")).getByRole("button", { name: MILESTONE_SELF_ADD.the_end.button }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(MILESTONE_CONSENTS.length);
    await user.type(screen.getByLabelText(/When did it happen/), "2026-05-01");
    await user.type(screen.getByLabelText(/how does it feel now/i), "Done.");
    await user.click(screen.getByRole("checkbox", { name: /homepage/ }));
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(actions.addMilestone).toHaveBeenCalledTimes(1));
    expect(actions.addMilestone).toHaveBeenCalledWith({
      kind: "the_end",
      projectId: NOVEL.id,
      bookId: "book_1",
      title: null,
      achievedOn: "2026-05-01",
      storyBefore: "",
      storyAfter: "Done.",
      consents: { consent_profile: false, consent_homepage: true, consent_testimonial: false },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
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
    expect(screen.getByText(/nothing is shown to anyone until you choose where/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, this is me" }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText(/before you got here/), "Stuck in chapter two.");
    await user.click(screen.getByRole("checkbox", { name: /My writer profile/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledTimes(1));
    expect(actions.answerMilestone).toHaveBeenCalledWith({
      id: "mlst_AAAAAAAAAAA1",
      answer: "confirm",
      achievedOn: null,
      storyBefore: "Stuck in chapter two.",
      storyAfter: "",
      consents: { consent_profile: true, consent_homepage: false, consent_testimonial: false },
    });
  });

  it("declines a proposal with one click and no form", async () => {
    vi.mocked(actions.answerMilestone).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone()]} projects={[NOVEL]} />);
    await user.click(screen.getByRole("button", { name: "Not me / not yet" }));
    await waitFor(() => expect(actions.answerMilestone).toHaveBeenCalledWith({ id: "mlst_AAAAAAAAAAA1", answer: "decline" }));
  });

  it("shows what a confirmed milestone may be used for, lets the member change it, and reopens a declined one", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x", consentHomepage: true })]} projects={[NOVEL]} />);
    expect(screen.getByText(/we may show it on: The Quill & Cup homepage/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("checkbox", { name: /homepage/ })).toBeChecked();
  });

  it("reopens a declined milestone", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel milestones={[milestone({ status: "declined" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/We won.t show it anywhere/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actually, it is me" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("says a confirmed milestone with no ticks stays private", () => {
    render(<MilestonesPanel milestones={[milestone({ status: "confirmed", confirmedAt: "x" })]} projects={[NOVEL]} />);
    expect(screen.getByText(/stays private/)).toBeInTheDocument();
  });

  it("is look-only while an admin views as the member", () => {
    render(<MilestonesPanel milestones={[milestone(), milestone({ id: "m2", kind: "publish_ready", projectId: NOVEL.id, status: "declined" })]} projects={[NOVEL]} readOnly />);
    expect(screen.getByRole("button", { name: "Yes, this is me" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not me / not yet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a work that is not listed here" })).toBeDisabled();
    expect(screen.getByText(/viewing as this member/)).toBeInTheDocument();
  });
});
