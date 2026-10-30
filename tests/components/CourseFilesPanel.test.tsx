// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import CourseFilesPanel from "@/app/(admin)/admin/courses/[id]/CourseFilesPanel";
import type { FilePlan, PlannedFile } from "@/lib/courses/files";

const file = (over: Partial<PlannedFile> = {}): PlannedFile => ({
  kajabiFileId: "f1",
  filename: "Tracker.pdf",
  lessonTitle: "Lesson 1",
  draft: false,
  position: 1,
  state: "ready_to_copy",
  sourceUrl: "https://kajabi.test/f",
  hubLessonId: "h1",
  ...over,
});
const plan = (files: PlannedFile[], stale: FilePlan["stale"] = []): FilePlan => ({ files, stale, courseId: "c1" });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CourseFilesPanel", () => {
  it("says so when no lesson has a download", () => {
    render(<CourseFilesPanel slug="c" plan={plan([])} />);
    expect(screen.getByText("No lesson has a download recorded.")).toBeInTheDocument();
  });

  it("marks draft lessons' files and says they are copied too, only when there are some", () => {
    const { rerender } = render(<CourseFilesPanel slug="c" plan={plan([file()])} />);
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.queryByText(/Files of draft lessons are copied too/)).not.toBeInTheDocument();

    rerender(<CourseFilesPanel slug="c" plan={plan([file(), file({ kajabiFileId: "f2", filename: "Plot.pdf", lessonTitle: "Draft: Plot", draft: true })])} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/Files of draft lessons are copied too/)).toBeInTheDocument();
    // One button covers both: files cost nothing to keep.
    expect(screen.getByRole("button", { name: "Copy 2 files" })).toBeEnabled();
  });

  it("lists each file with its lesson and state, and what will be removed", () => {
    render(
      <CourseFilesPanel
        slug="c"
        plan={plan(
          [
            file(),
            file({ kajabiFileId: "f2", filename: "Done.pdf", state: "copied" }),
            file({ kajabiFileId: "f3", filename: "Old.pdf", state: "link_expired" }),
            file({ kajabiFileId: "f4", filename: "Early.pdf", state: "lesson_not_in_hub" }),
          ],
          [{ id: "s1", storagePath: "p", filename: "Gone.pdf" }]
        )}
      />
    );

    expect(screen.getByText("Ready to copy")).toBeInTheDocument();
    expect(screen.getByText("In the Hub")).toBeInTheDocument();
    expect(screen.getByText("Link expired: run the content step again")).toBeInTheDocument();
    expect(screen.getByText("Its lesson isn't in the Hub yet: publish or sync first")).toBeInTheDocument();
    expect(screen.getByText("No longer listed: will be removed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy 1 file and remove 1" })).toBeEnabled();
  });

  it("copies on one click (no confirm: it costs nothing), reports the outcome and refreshes", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ copied: [{}, {}], removed: 1, needsNewLink: [{}], failed: [] }) });
    render(<CourseFilesPanel slug="the-ready-writer" plan={plan([file(), file({ kajabiFileId: "f2" })])} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy 2 files" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copied 2, removed 1, 1 need a new link.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "the-ready-writer" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a failure as an error", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ copied: [], removed: 0, needsNewLink: [], failed: [{ error: "source answered 403" }] }) });
    render(<CourseFilesPanel slug="c" plan={plan([file()])} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy 1 file" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 failed: source answered 403");
  });

  it("copies the course images even when no lesson has a download, and reports them", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ copied: [], removed: 0, needsNewLink: [], failed: [], images: { copied: 5, removed: 1, alreadyCopied: 0, failed: [] } }),
    });
    render(<CourseFilesPanel slug="c" plan={plan([])} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy images" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copied 0, images: copied 5, removed 1.");
    expect(refresh).toHaveBeenCalled();
  });

  it("says nothing about images when there was nothing to do", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ copied: [], removed: 0, needsNewLink: [], failed: [], images: { copied: 0, removed: 0, alreadyCopied: 40, failed: [] } }),
    });
    render(<CourseFilesPanel slug="c" plan={plan([])} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy images" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^Copied 0\.$/);
  });

  it("shows a failed image as an error", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ copied: [], removed: 0, needsNewLink: [], failed: [], images: { copied: 0, removed: 0, alreadyCopied: 0, failed: [{ error: "source answered 404" }] } }),
    });
    render(<CourseFilesPanel slug="c" plan={plan([])} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy images" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 images failed: source answered 404");
  });

  it("has nothing to do when everything is copied, and asks to publish first when the course isn't", () => {
    const { rerender } = render(<CourseFilesPanel slug="c" plan={plan([file({ state: "copied" })])} />);
    expect(screen.getByRole("button", { name: "Copy 0 files" })).toBeDisabled();

    rerender(<CourseFilesPanel slug={null} plan={plan([file()])} />);
    expect(screen.getByText(/Publish the course first/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
