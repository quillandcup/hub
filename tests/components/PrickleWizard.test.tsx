// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrickleWizard from "@/app/(member)/prickle-picker/PrickleWizard";
import { getWizardRecommendations } from "@/app/(member)/prickle-picker/actions";
import type { PickerRecommendation } from "@/lib/prickle-picker";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/(member)/prickle-picker/actions", () => ({
  getWizardRecommendations: vi.fn(),
}));

const members = [
  { id: "sue", name: "Sue", email: "sue@example.com" },
  { id: "jane", name: "Jane", email: "jane@example.com" },
];

const sampleRecommendation: PickerRecommendation = {
  seriesKey: "type-writing:host-a",
  typeId: "type-writing",
  typeName: "Heads Down",
  hostId: "host-a",
  hostName: "Host A",
  purpose: "writing",
  scheduleLabel: "Mondays at 10:00 AM ET",
  vibe: "focused",
  vibeSource: "inferred",
  vibeNotes: null,
  avgAttendance: 5,
  sessionCount: 10,
  coAttendanceRate: null,
  personal: null,
  score: 1.5,
  occurrences: [{ id: "p1", startTime: "2026-01-05T15:00:00Z" }],
};

async function next() {
  await userEvent.click(screen.getByRole("button", { name: "Next →" }));
}

async function goToLastStep() {
  for (let i = 0; i < 4; i++) await next();
}

beforeEach(() => {
  vi.mocked(getWizardRecommendations).mockReset();
});

describe("PrickleWizard", () => {
  it("starts on the 'how are you feeling' step", () => {
    render(<PrickleWizard members={members} />);
    expect(screen.getByText("How are you feeling?")).toBeInTheDocument();
  });

  it("walks through all five steps via Next/Back", async () => {
    render(<PrickleWizard members={members} />);

    await next();
    expect(screen.getByText("When works for you?")).toBeInTheDocument();

    await next();
    expect(screen.getByText("What's the mood?")).toBeInTheDocument();

    await next();
    expect(screen.getByText("What are you here for?")).toBeInTheDocument();

    await next();
    expect(screen.getByText("Anyone you're hoping to see there?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("What are you here for?")).toBeInTheDocument();
  });

  it("submits feelings and need, and pre-selects the mood the need points at", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [sampleRecommendation] });
    render(<PrickleWizard members={members} />);

    await userEvent.click(screen.getByRole("button", { name: "Stressed" }));
    await userEvent.click(screen.getByRole("button", { name: "Lonely" }));
    expect(screen.getByRole("button", { name: "Calm" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Company" }));
    await next();
    await next();
    // Company points at a chatty room.
    expect(screen.getByRole("button", { name: "Chatty" })).toHaveClass("bg-plum-600");

    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(getWizardRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ feelings: ["stressed", "lonely"], need: "company", vibe: "chatty" })
    );
    // Links carry the answers so the prickle's check-in card starts pre-filled.
    expect(await screen.findByRole("link", { name: /Jan/ })).toHaveAttribute(
      "href",
      "/prickles/p1?feel=stressed%2Clonely&need=company"
    );
  });

  it("keeps a mood the member already picked instead of the need's", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [] });
    render(<PrickleWizard members={members} />);

    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Focused" }));
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: "Company" }));
    await goToLastStep();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(getWizardRecommendations).toHaveBeenCalledWith(expect.objectContaining({ vibe: "focused" }));
  });

  it("shows how the member rated a series when they felt similar", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({
      recommendations: [{ ...sampleRecommendation, personal: { sessions: 3, avgRating: 4.3 } }],
    });
    render(<PrickleWizard members={members} />);
    await goToLastStep();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(await screen.findByText("You rated it Good on average (3 similar sessions)")).toBeInTheDocument();
  });

  it("submits the selected answers and renders results", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [sampleRecommendation] });

    render(<PrickleWizard members={members} />);

    await next();
    await userEvent.click(screen.getByRole("button", { name: "Evening" }));
    for (let i = 0; i < 3; i++) await next();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(await screen.findByText("Heads Down")).toBeInTheDocument();
    expect(getWizardRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ timeOfDay: "evening", withMemberIds: [] })
    );
  });

  it("includes selected members in the submitted answers", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [] });

    render(<PrickleWizard members={members} />);
    await goToLastStep();

    await userEvent.type(screen.getByPlaceholderText(/search for a hedgie/i), "Sue");
    await userEvent.click(await screen.findByText("Sue"));

    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(await screen.findByText("No matches this time")).toBeInTheDocument();
    expect(getWizardRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ withMemberIds: ["sue"] })
    );
  });

  it("shows an error message when the action fails", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ error: "Not authenticated" });

    render(<PrickleWizard members={members} />);
    await goToLastStep();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));

    expect(await screen.findByText("Not authenticated")).toBeInTheDocument();
  });

  it("returns to the first step on 'Start over'", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [sampleRecommendation] });

    render(<PrickleWizard members={members} />);
    await goToLastStep();
    await userEvent.click(screen.getByRole("button", { name: /show me prickles/i }));
    await screen.findByText("Heads Down");

    await userEvent.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText("How are you feeling?")).toBeInTheDocument();
  });
});
