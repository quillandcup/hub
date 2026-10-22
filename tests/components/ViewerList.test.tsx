// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ViewerList from "@/app/(admin)/admin/courses/[id]/stats/ViewerList";
import type { ViewSession } from "@/lib/courses/watch-stats-data";

const session = (overrides: Partial<ViewSession> = {}): ViewSession => ({
  sessionId: "s1",
  memberId: "mbr_1",
  memberName: "Fern Quillsby",
  startedAt: "2026-10-01T15:00:00Z",
  userAgent: null,
  played: true,
  watchedSeconds: 90,
  coveredFraction: 0.5,
  intervals: [[0, 0.5]],
  location: null,
  ...overrides,
});

describe("ViewerList", () => {
  it("says so when nobody has opened the video", () => {
    render(<ViewerList sessions={[]} durationSeconds={300} shown={10} more={null} />);

    expect(screen.getByText(/Nobody has opened this lesson/)).toBeInTheDocument();
  });

  it("lists a row per visit, its summary the container-measured row that stops wrapping from @pair", () => {
    render(<ViewerList sessions={[session(), session({ sessionId: "s2", memberName: "Quill Hollis", played: false, intervals: [], coveredFraction: 0 })]} durationSeconds={300} shown={10} more={null} />);

    const row = screen.getByRole("link", { name: "Fern Quillsby" }).closest("summary")!;
    expect(row).toHaveClass("flex-wrap", "@pair:flex-nowrap");
    expect(row.closest("details")).toHaveClass("@container");
    expect(screen.getByRole("link", { name: "Quill Hollis" })).toHaveAttribute("href", "/admin/members/mbr_1");
    expect(screen.getByRole("img", { name: /Covered 50% of the video: 0:00 to 2:30/ })).toBeInTheDocument();
  });

  it("offers Load more only when there is more", () => {
    const { rerender } = render(<ViewerList sessions={[session()]} durationSeconds={300} shown={1} more="/more" />);

    expect(screen.getByRole("link", { name: /more/i })).toHaveAttribute("href", "/more");

    rerender(<ViewerList sessions={[session()]} durationSeconds={300} shown={1} more={null} />);
    expect(screen.queryByRole("link", { name: /more/i })).not.toBeInTheDocument();
  });
});
