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
  score: 1.5,
  occurrences: [{ id: "p1", startTime: "2026-01-05T15:00:00Z" }],
};

async function goToLastStep() {
  await userEvent.click(screen.getByRole("button", { name: "Next →" }));
  await userEvent.click(screen.getByRole("button", { name: "Next →" }));
  await userEvent.click(screen.getByRole("button", { name: "Next →" }));
}

beforeEach(() => {
  vi.mocked(getWizardRecommendations).mockReset();
});

describe("PrickleWizard", () => {
  it("starts on the 'when works for you' step", () => {
    render(<PrickleWizard members={members} />);
    expect(screen.getByText("When works for you?")).toBeInTheDocument();
  });

  it("walks through all four steps via Next/Back", async () => {
    render(<PrickleWizard members={members} />);

    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("What's the mood?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("What are you here for?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("Anyone you're hoping to see there?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("What are you here for?")).toBeInTheDocument();
  });

  it("submits the selected answers and renders results", async () => {
    vi.mocked(getWizardRecommendations).mockResolvedValue({ recommendations: [sampleRecommendation] });

    render(<PrickleWizard members={members} />);

    await userEvent.click(screen.getByRole("button", { name: "Evening" }));
    await goToLastStep();
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
    expect(screen.getByText("When works for you?")).toBeInTheDocument();
  });
});
