// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Prospect } from "@/lib/data/prospects";

const actions = vi.hoisted(() => ({ importProspects: vi.fn(), reviewProspect: vi.fn() }));
vi.mock("@/app/(admin)/admin/outreach/prospects/actions", () => actions);

import ProspectsView from "@/app/(admin)/admin/outreach/prospects/ProspectsView";

const prospect = (over: Partial<Prospect>): Prospect => ({
  id: "prsp_AAAAAAAAAAA1",
  handle: "ada.example",
  source: "paste",
  sourceNote: null,
  bio: "Working on my first novel",
  followerCount: 2300,
  hashtags: [],
  externalUrl: null,
  fitScore: 65,
  fitReasons: ["Says they are working on a book or draft (+30)"],
  status: "new",
  rejectReason: null,
  assessment: null,
  reviewedAt: null,
  createdAt: "2097-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  actions.importProspects.mockResolvedValue({ summary: { added: 2, alreadyProspects: 1, alreadyMembers: 1, unreadable: ["x"] } });
  actions.reviewProspect.mockResolvedValue({ ok: true });
});

describe("ProspectsView", () => {
  it("shows a prospect with its score and reasons, and an AI read when there is one", () => {
    render(<ProspectsView prospects={[prospect({ assessment: { fit: "strong", summary: "Drafting a novel.", opener: "Loved your post." } })]} />);

    expect(screen.getByRole("link", { name: "@ada.example" })).toHaveAttribute("href", "https://www.instagram.com/ada.example/");
    expect(screen.getByText(/fit 65/)).toBeInTheDocument();
    expect(screen.getByText(/working on a book or draft/)).toBeInTheDocument();
    expect(screen.getByText(/Draft opener: Loved your post\./)).toBeInTheDocument();
  });

  it("imports pasted text and reports what happened", async () => {
    render(<ProspectsView prospects={[]} />);
    const add = screen.getByRole("button", { name: "Add and score" });
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Prospects to add"), "@ada.example");
    await userEvent.click(add);

    expect(actions.importProspects).toHaveBeenCalledWith("@ada.example");
    expect(await screen.findByRole("status")).toHaveTextContent("2 added, 1 already on the list, 1 already in the Hub, 1 line skipped");
    expect(screen.getByLabelText("Prospects to add")).toHaveValue("");
  });

  it("shows an import error and keeps the text", async () => {
    actions.importProspects.mockResolvedValue({ error: "Not authorized" });
    render(<ProspectsView prospects={[]} />);
    await userEvent.type(screen.getByLabelText("Prospects to add"), "@ada.example");
    await userEvent.click(screen.getByRole("button", { name: "Add and score" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Not authorized");
    expect(screen.getByLabelText("Prospects to add")).toHaveValue("@ada.example");
  });

  it("shortlists, rejects with a reason, and moves a shortlisted prospect on", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("sells editing");
    render(<ProspectsView prospects={[prospect({}), prospect({ id: "prsp_AAAAAAAAAAA2", handle: "bob.example", status: "shortlisted" }), prospect({ id: "prsp_AAAAAAAAAAA3", handle: "cy.example", status: "rejected", rejectReason: "no" })]} />);

    await userEvent.click(screen.getByRole("button", { name: "Shortlist" }));
    expect(actions.reviewProspect).toHaveBeenCalledWith("prsp_AAAAAAAAAAA1", "shortlisted", undefined);

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(actions.reviewProspect).toHaveBeenCalledWith("prsp_AAAAAAAAAAA1", "rejected", "sells editing");

    await userEvent.click(screen.getByRole("tab", { name: /Shortlisted \(1\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark contacted" }));
    expect(actions.reviewProspect).toHaveBeenCalledWith("prsp_AAAAAAAAAAA2", "contacted", undefined);

    await userEvent.click(screen.getByRole("tab", { name: /Rejected \(1\)/ }));
    expect(screen.getByText("Rejected: no")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.reviewProspect).toHaveBeenCalledWith("prsp_AAAAAAAAAAA3", "new", undefined);
  });

  it("shows a review error and an empty state", async () => {
    actions.reviewProspect.mockResolvedValue({ error: "Unknown prospect." });
    render(<ProspectsView prospects={[prospect({})]} />);
    await userEvent.click(screen.getByRole("button", { name: "Shortlist" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Unknown prospect."));

    await userEvent.click(screen.getByRole("tab", { name: /Contacted/ }));
    expect(screen.getByText("Nobody here yet.")).toBeInTheDocument();
  });
});
