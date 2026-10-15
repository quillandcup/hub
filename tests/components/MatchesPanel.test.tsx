// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MentorshipRow } from "@/lib/mentorship";
import type { Arrival } from "@/lib/arrivals";

const createMentorship = vi.fn();
const updateMentorship = vi.fn();
vi.mock("@/app/(admin)/admin/mentorship/actions", () => ({
  createMentorship: (...args: unknown[]) => createMentorship(...args),
  updateMentorship: (...args: unknown[]) => updateMentorship(...args),
  deleteMentorship: vi.fn(),
}));

import MatchesPanel from "@/app/(admin)/admin/mentorship/MatchesPanel";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const row: MentorshipRow = {
  id: "x",
  mentorMemberId: A,
  mentorName: "Ada Quill",
  newMemberId: B,
  newMemberName: "Bea Moss",
  startedOn: "2026-03-01",
  trialEndsOn: "2026-03-08",
  kind: "trial",
  status: "matched",
  active: false,
  outcomeNote: null,
  outcome: "converted",
  convertedOn: "2026-03-20",
  currentMember: true,
};

beforeEach(() => {
  createMentorship.mockResolvedValue({ success: true });
  updateMentorship.mockResolvedValue({ success: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        members: [
          { id: A, name: "Ada Quill", email: "ada@example.test" },
          { id: B, name: "Bea Moss", email: "bea@example.test" },
          { id: "33333333-3333-4333-8333-333333333333", name: "Cleo Fern", email: "cleo@example.test" },
        ],
      }),
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MatchesPanel", () => {
  it("shows each match with its derived outcome", () => {
    render(<MatchesPanel rows={[row]} openLoad={{}} />);
    expect(screen.getByText("Bea Moss")).toBeInTheDocument();
    expect(screen.getByText(/Converted · current member/)).toBeInTheDocument();
  });

  it("shows when the trial ends", () => {
    render(<MatchesPanel rows={[row]} openLoad={{}} />);
    expect(screen.getByText(/trial ends/)).toBeInTheDocument();
  });

  it("opens the form with the trial member from the Work Queue's Assign link", async () => {
    const user = userEvent.setup();
    render(
      <MatchesPanel
        rows={[]}
        openLoad={{}}
       
        prefill={{ newMember: { id: B, name: "Bea Moss", email: "bea@example.test" } }}
      />
    );
    expect(screen.getByText("Bea Moss")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Search for big sister..."), "Ada");
    await user.click(await screen.findByText("Ada Quill"));
    await user.click(screen.getByRole("button", { name: "Add match" }));
    await waitFor(() =>
      expect(createMentorship).toHaveBeenCalledWith(
        expect.objectContaining({ newMemberId: B })
      )
    );
  });

  it("offers volunteers as one-click picks, best fit first", async () => {
    const user = userEvent.setup();
    render(
      <MatchesPanel
        rows={[]}
        openLoad={{}}
       
        volunteers={[
          { memberId: A, name: "Ada Quill", note: "mornings", volunteeredAt: "2026-01-01T00:00:00Z", openLoad: 0, totalMatches: 0, lastStartedOn: null },
          { memberId: B, name: "Bea Moss", note: null, volunteeredAt: "2026-01-02T00:00:00Z", openLoad: 1, totalMatches: 2, lastStartedOn: "2026-05-20" },
        ]}
        prefill={{ newMember: { id: "33333333-3333-4333-8333-333333333333", name: "Cleo Fern", email: "c@example.test" } }}
      />
    );
    expect(screen.getByText("free now · never matched")).toBeInTheDocument();
    expect(screen.getByText(/1 new member now · last matched/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ada Quill/ }));
    await user.click(screen.getByRole("button", { name: "Add match" }));
    await waitFor(() => expect(createMentorship).toHaveBeenCalledWith(expect.objectContaining({ mentorMemberId: A })));
  });

  it("lists new members still waiting for a big sister and picks one in a click", async () => {
    const user = userEvent.setup();
    const waiting: Arrival[] = [
      { memberId: B, memberName: "Bea Moss", arrivedOn: "2026-05-30", kind: "program", trialEndsOn: null, programName: "Ready Writers" },
    ];
    render(<MatchesPanel rows={[]} openLoad={{}} waiting={waiting} />);
    expect(screen.getByText(/Ready Writers · /)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Bea Moss/ }));
    await user.type(screen.getByPlaceholderText("Search for big sister..."), "Ada");
    await user.click(await screen.findByText("Ada Quill"));
    await user.click(screen.getByRole("button", { name: "Add match" }));
    await waitFor(() => expect(createMentorship).toHaveBeenCalledWith({ mentorMemberId: A, newMemberId: B }));
  });

  it("doesn't ask for a start date or a note: they come from the sign-up and the big sister", () => {
    render(<MatchesPanel rows={[]} openLoad={{}} />);
    expect(screen.queryByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toBeNull();
    expect(screen.queryByText("Trial start")).toBeNull();
  });

  it("warns when the chosen big sister already has a new member inside their 30 days", async () => {
    const user = userEvent.setup();
    render(<MatchesPanel rows={[]} openLoad={{ [A]: 1 }} />);
    await user.type(screen.getByPlaceholderText("Search for big sister..."), "Ada");
    await user.click(await screen.findByText("Ada Quill"));
    expect(screen.getByText(/already has a new member in their first 30 days/)).toBeInTheDocument();
  });

  it("creates a match from the form", async () => {
    const user = userEvent.setup();
    render(<MatchesPanel rows={[]} openLoad={{}} />);
    await user.type(screen.getByPlaceholderText("Search for big sister..."), "Ada");
    await user.click(await screen.findByText("Ada Quill"));
    await user.type(screen.getByPlaceholderText("Search for new member..."), "Cleo");
    await user.click(await screen.findByText("Cleo Fern"));
    await user.click(screen.getByRole("button", { name: "Add match" }));
    await waitFor(() =>
      expect(createMentorship).toHaveBeenCalledWith({
        mentorMemberId: A,
        newMemberId: "33333333-3333-4333-8333-333333333333",
      })
    );
  });

  it("saves an edited note", async () => {
    const user = userEvent.setup();
    render(<MatchesPanel rows={[row]} openLoad={{}} />);
    await user.click(screen.getByTitle("Edit note"));
    await user.type(screen.getByLabelText("Note for Bea Moss"), "loved it");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateMentorship).toHaveBeenCalledWith("x", { outcomeNote: "loved it" }));
  });

  it("shows the error when the action refuses", async () => {
    createMentorship.mockResolvedValue({ error: "That trial member already has a big sister." });
    const user = userEvent.setup();
    render(<MatchesPanel rows={[]} openLoad={{}} />);
    await user.type(screen.getByPlaceholderText("Search for big sister..."), "Ada");
    await user.click(await screen.findByText("Ada Quill"));
    await user.type(screen.getByPlaceholderText("Search for new member..."), "Bea");
    await user.click(await screen.findByText("Bea Moss"));
    await user.click(screen.getByRole("button", { name: "Add match" }));
    expect(await screen.findByText("That trial member already has a big sister.")).toBeInTheDocument();
  });
});
