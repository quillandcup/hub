// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveReasonNote = vi.fn();
vi.mock("@/app/(member)/big-sisters/actions", () => ({
  saveReasonNote: (...args: unknown[]) => saveReasonNote(...args),
  setBigSisterAvailability: vi.fn(),
}));

import BigSisterCards from "@/components/member/BigSisterCards";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const partner = (overrides = {}) => ({
  mentorshipId: "ms-1",
  memberId: "m-ada",
  name: "Ada Quill",
  photoUrl: null,
  startedOn: "2026-06-01",
  kind: "trial" as const,
  ...overrides,
});
const mentee = (overrides = {}) => ({ ...partner(overrides), canRecordReason: false, note: null });

describe("BigSisterCards", () => {
  it("renders nothing for a member with no current match", () => {
    const { container } = render(<BigSisterCards mentorships={{ bigSister: null, mentees: [] }} slackLinks={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a new member their big sister, with a Slack link when there is one", () => {
    render(
      <BigSisterCards
        mentorships={{ bigSister: partner(), mentees: [] }}
        slackLinks={{ "m-ada": "https://slack.example.test/dm" }}
      />
    );
    expect(screen.getByText("Your Big Sister")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Quill" })).toHaveAttribute("href", "/members/m-ada");
    expect(screen.getByRole("link", { name: "Say hi on Slack" })).toHaveAttribute("href", "https://slack.example.test/dm");
  });

  it("shows a big sister her new members and links to the page from the dashboard", () => {
    render(
      <BigSisterCards
        mentorships={{ bigSister: null, mentees: [mentee({ memberId: "m-bea", name: "Bea Moss" })] }}
        slackLinks={{}}
        linkToPage
      />
    );
    expect(screen.getByText("Your new member")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Say hi on Slack" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: /About Big Sisters/ })).toHaveAttribute("href", "/big-sisters");
  });

  it("asks a big sister why a trial didn't continue, and saves what she writes", async () => {
    saveReasonNote.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(
      <BigSisterCards
        mentorships={{ bigSister: null, mentees: [{ ...mentee({ name: "Bea Moss" }), canRecordReason: true }] }}
        slackLinks={{}}
      />
    );
    expect(screen.getByText(/Bea Moss didn't stay after their trial/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "the price");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveReasonNote).toHaveBeenCalledWith("ms-1", "the price"));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it("shows the reason already written and shows the error if saving fails", async () => {
    saveReasonNote.mockResolvedValue({ error: "That isn't one of your matches." });
    const user = userEvent.setup();
    render(
      <BigSisterCards
        mentorships={{ bigSister: null, mentees: [{ ...mentee(), canRecordReason: true, note: "timing" }] }}
        slackLinks={{}}
      />
    );
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue("timing");
    await user.type(box, " of year");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That isn't one of your matches.")).toBeInTheDocument();
  });
});
