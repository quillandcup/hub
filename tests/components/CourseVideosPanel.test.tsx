// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import CourseVideosPanel from "@/app/(admin)/admin/courses/[id]/CourseVideosPanel";
import type { PlannedVideo } from "@/lib/courses/media";

const video = (over: Partial<PlannedVideo> = {}): PlannedVideo => ({
  mediaId: "m1",
  draft: false,
  lessonTitles: ["Lesson 1: Reader Expectations"],
  durationSeconds: 600,
  state: "ready_to_upload",
  downloadUrl: "https://kajabi.test/v",
  retryVideoId: null,
  videoStatus: null,
  ...over,
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CourseVideosPanel", () => {
  it("says so when no visible lesson has a video", () => {
    render(<CourseVideosPanel slug="c" videos={[]} />);
    expect(screen.getByText(/No visible lesson has a video recorded yet/)).toBeInTheDocument();
  });

  it("lists each video with its length and state", () => {
    render(
      <CourseVideosPanel
        slug="c"
        videos={[
          video(),
          video({ mediaId: "m2", lessonTitles: ["B"], state: "uploaded", videoStatus: "ready", durationSeconds: 120 }),
          video({ mediaId: "m3", lessonTitles: ["C"], state: "uploaded", videoStatus: "preparing" }),
          video({ mediaId: "m4", lessonTitles: ["D"], state: "link_expired" }),
          video({ mediaId: "m5", lessonTitles: ["E"], state: "ready_to_upload", videoStatus: "errored", retryVideoId: "v" }),
        ]}
      />
    );

    expect(screen.getByText("Ready to upload")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Preparing in Mux")).toBeInTheDocument();
    expect(screen.getByText("Link expired: run the Kajabi content step again")).toBeInTheDocument();
    expect(screen.getByText("Failed last time (will retry)")).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
  });

  it("asks before uploading, saying how much will be billed, and does nothing on cancel", async () => {
    render(<CourseVideosPanel slug="c" videos={[video(), video({ mediaId: "m2", durationSeconds: 300 })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload 2 to Mux" }));

    expect(screen.getByText(/Upload 2 videos \(about 15 minutes\) to Mux\? Mux bills per minute\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Upload 2 to Mux" })).toBeInTheDocument();
  });

  it("uploads on confirm, reports the outcome and refreshes the page", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ upload: { uploaded: [{}, {}], needsNewLink: [{}], failed: [] }, refresh: { ready: 1, stillPreparing: 1 } }),
    });
    render(<CourseVideosPanel slug="the-ready-writer" videos={[video(), video({ mediaId: "m2" })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload 2 to Mux" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Uploaded 2. 1 need a new link. 1 ready, 1 still preparing.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "the-ready-writer", action: "upload" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a failed upload as an error", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ upload: { uploaded: [], needsNewLink: [], failed: [{ error: "Mux said no" }] }, refresh: { ready: 0, stillPreparing: 0 } }),
    });
    render(<CourseVideosPanel slug="c" videos={[video()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 to Mux" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 failed: Mux said no");
  });

  it("offers a status update only while something is preparing, and shows the server's error", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Mux isn't configured here" }) });
    const { rerender } = render(<CourseVideosPanel slug="c" videos={[video({ state: "uploaded", videoStatus: "ready" })]} />);
    expect(screen.getByRole("button", { name: "Update status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload 0 to Mux" })).toBeDisabled();

    rerender(<CourseVideosPanel slug="c" videos={[video({ state: "uploaded", videoStatus: "preparing" })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Update status" }));
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "c", action: "refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mux isn't configured here");
  });

  it("asks to publish the course first when it isn't published", () => {
    render(<CourseVideosPanel slug={null} videos={[video()]} />);
    expect(screen.getByText(/Publish the course first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload/ })).not.toBeInTheDocument();
  });
  describe("draft lessons' videos", () => {
    const draft = (over: Partial<PlannedVideo> = {}) => video({ mediaId: "d1", draft: true, lessonTitles: ["Draft: Plot twists"], durationSeconds: 1200, ...over });

    it("lists them apart from the visible lessons' videos, so the normal upload can't be mistaken for theirs", () => {
      render(<CourseVideosPanel slug="c" videos={[video(), draft()]} />);

      expect(screen.getByText("Lesson 1: Reader Expectations")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Draft lessons' videos" })).toBeInTheDocument();
      expect(screen.getByText("Draft: Plot twists")).toBeInTheDocument();
      // One button each, each counting only its own list.
      expect(screen.getByRole("button", { name: "Upload 1 to Mux" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload 1 draft video to Mux" })).toBeInTheDocument();
    });

    it("shows a course whose only videos are drafts' as having drafts, not as having none", () => {
      render(<CourseVideosPanel slug="c" videos={[draft()]} />);
      expect(screen.queryByText(/No visible lesson has a video recorded yet/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload 1 draft video to Mux" })).toBeEnabled();
    });

    it("asks before uploading drafts, says how many minutes are billed, and sends the drafts action", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, upload: { uploaded: [{}], needsNewLink: [], failed: [] }, refresh: { ready: 0, stillPreparing: 1 } })));
      const user = userEvent.setup();
      render(<CourseVideosPanel slug="c" videos={[video(), draft()]} />);

      await user.click(screen.getByRole("button", { name: "Upload 1 draft video to Mux" }));
      expect(screen.getByText(/Upload 1 draft video \(about 20 minutes\) to Mux\? Mux bills per minute\./)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Upload drafts" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "c", action: "upload_drafts" });
    });

    it("sends the normal action from the normal button, never the drafts one", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, upload: { uploaded: [{}], needsNewLink: [], failed: [] }, refresh: { ready: 0, stillPreparing: 1 } })));
      const user = userEvent.setup();
      render(<CourseVideosPanel slug="c" videos={[video(), draft()]} />);

      await user.click(screen.getByRole("button", { name: "Upload 1 to Mux" }));
      await user.click(screen.getByRole("button", { name: "Upload" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "c", action: "upload" });
    });

    it("can be cancelled without uploading, and is disabled when there is nothing to upload", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<CourseVideosPanel slug="c" videos={[draft()]} />);
      await user.click(screen.getByRole("button", { name: "Upload 1 draft video to Mux" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(fetchMock).not.toHaveBeenCalled();

      rerender(<CourseVideosPanel slug="c" videos={[draft({ state: "uploaded", videoStatus: "ready" })]} />);
      expect(screen.getByRole("button", { name: "Upload 0 draft videos to Mux" })).toBeDisabled();
    });
  });
});
