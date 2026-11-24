// @vitest-environment jsdom
/** The quiz builder's Results tab and the tabs between a quiz lesson's pages. */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuizResultsTable from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizResultsTable";
import QuizLessonTabs, { quizTabPath } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizLessonTabs";
import type { QuizResultRow } from "@/lib/courses/admin-quiz";

const row = (i: number, over: Partial<QuizResultRow> = {}): QuizResultRow => ({
  attemptId: `qatt_AAAAAAAAAA${String(i).padStart(2, "0")}`,
  memberId: `mbr_AAAAAAAAAA${String(i).padStart(2, "0")}`,
  name: `Member ${i}`,
  submittedAt: "2027-01-05T15:30:00.000Z",
  scorePercent: 100,
  correctCount: 2,
  questionCount: 2,
  passed: true,
  ...over,
});

describe("QuizResultsTable", () => {
  it("says so when nobody has taken the quiz", () => {
    render(<QuizResultsTable rows={[]} graded />);
    expect(screen.getByText("Nobody has taken this quiz yet.")).toBeInTheDocument();
  });

  it("lists attempts with the member linked, the score, and Passed or Not passed for a graded quiz", () => {
    render(<QuizResultsTable rows={[row(1), row(2, { scorePercent: 50, correctCount: 1, passed: false })]} graded />);
    expect(screen.getByRole("link", { name: "Member 1" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAA01");
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Passed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("100%")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not passed")).toBeInTheDocument();
    expect(within(rows[2]).getByText("(1 of 2)")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/January 5, 2027/)).toBeInTheDocument();
  });

  it("says the lesson was completed, not passed, when the quiz has no passing grade", () => {
    render(<QuizResultsTable rows={[row(1, { scorePercent: 0, correctCount: 0, passed: true })]} graded={false} />);
    expect(screen.getByRole("columnheader", { name: "Counted" })).toBeInTheDocument();
    expect(screen.getByText("Completed the lesson")).toBeInTheDocument();
  });

  it("pages through a long list", async () => {
    const user = userEvent.setup();
    render(<QuizResultsTable rows={Array.from({ length: 30 }, (_, i) => row(i + 1))} graded />);
    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.queryByText("Member 26")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Member 26")).toBeInTheDocument();
    expect(screen.queryByText("Member 1")).not.toBeInTheDocument();
  });
});

describe("QuizLessonTabs", () => {
  it("links the four pages as paths and marks the current one", () => {
    render(<QuizLessonTabs base="/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1" current="questions" />);
    const hrefs = Object.fromEntries(screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]));
    expect(hrefs).toEqual({
      Details: "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1",
      Questions: "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1/questions",
      Settings: "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1/settings",
      Results: "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1/results",
    });
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Details" })).not.toHaveAttribute("aria-current");
    expect(quizTabPath("/x", "details")).toBe("/x");
  });
});
