// @vitest-environment jsdom
/** Upload, replace and remove a Hub-owned lesson's video. The actions and the chunked uploader are faked; what is tested is what the controls ask for and show. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ startLessonVideoUpload: vi.fn(), refreshLessonVideo: vi.fn(), removeLessonVideo: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/lesson-video-actions", () => actions);

type Handler = (event: { detail: unknown }) => void;
const uploader = vi.hoisted(() => ({ handlers: {} as Record<string, Handler>, options: null as null | { endpoint: () => Promise<string>; file: File }, throwOnCreate: false }));
vi.mock("@mux/upchunk", () => ({
  createUpload: (options: { endpoint: () => Promise<string>; file: File }) => {
    if (uploader.throwOnCreate) throw new Error("file size exceeds maximum");
    uploader.options = options;
    uploader.handlers = {};
    return { on: (name: string, handler: Handler) => void (uploader.handlers[name] = handler) };
  },
}));

import LessonVideoControls from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonVideoControls";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const file = () => new File(["x"], "lesson.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.clearAllMocks();
  uploader.throwOnCreate = false;
  uploader.options = null;
});
afterEach(() => {
  vi.useRealTimers();
});

const choose = async () => {
  fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [file()] } });
  await waitFor(() => expect(uploader.options).not.toBeNull());
};

describe("a lesson without a video", () => {
  it("offers Upload video, and nothing to remove or check", () => {
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    expect(screen.getByRole("button", { name: "Upload video" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove video" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("sends the chosen file, asks for its upload address only then, shows the progress, and checks on the video when it is done", async () => {
    actions.startLessonVideoUpload.mockResolvedValue({ url: "https://storage.example/up" });
    actions.refreshLessonVideo.mockResolvedValue({ status: "preparing" });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    await choose();

    expect(uploader.options!.file.name).toBe("lesson.mp4");
    expect(actions.startLessonVideoUpload).not.toHaveBeenCalled();
    expect(await uploader.options!.endpoint()).toBe("https://storage.example/up");
    expect(actions.startLessonVideoUpload).toHaveBeenCalledWith(COURSE, LESSON);

    act(() => uploader.handlers.progress({ detail: 41.6 }));
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("button", { name: "Upload video" })).toBeDisabled();

    act(() => uploader.handlers.success({ detail: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("Uploaded. Mux is preparing the video.");
    expect(actions.refreshLessonVideo).toHaveBeenCalledWith(COURSE, LESSON);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("refuses to start the upload when the address is refused, and says why", async () => {
    actions.startLessonVideoUpload.mockResolvedValue({ error: "Couldn't start the upload." });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    await choose();
    await expect(uploader.options!.endpoint()).rejects.toThrow("Couldn't start the upload.");
  });

  it("shows why an upload failed, refreshes the page, and lets the person try again", async () => {
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    await choose();
    act(() => uploader.handlers.error({ detail: "network lost" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The upload didn't finish: network lost");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Upload video" })).toBeEnabled();
  });

  it("says when the upload failed without a reason, or with an object that carries one", async () => {
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    await choose();
    act(() => uploader.handlers.error({ detail: undefined }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^The upload didn't finish\.$/);
    act(() => uploader.handlers.error({ detail: { message: "too big" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The upload didn't finish: too big");
  });

  it("says why the uploader could not be set up", async () => {
    uploader.throwOnCreate = true;
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [file()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("file size exceeds maximum");
  });

  it("does nothing when no file is chosen", () => {
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [] } });
    expect(uploader.options).toBeNull();
  });

  it("opens the file chooser from the button", async () => {
    const user = userEvent.setup();
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status={null} />);
    const clicked = vi.fn();
    screen.getByLabelText("Choose a video file").addEventListener("click", clicked);
    await user.click(screen.getByRole("button", { name: "Upload video" }));
    expect(clicked).toHaveBeenCalled();
  });
});

describe("a lesson with a video", () => {
  it("offers Replace video and Remove video, and checks on nothing once it is ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="ready" />);
    expect(screen.getByRole("button", { name: "Replace video" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove video" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(actions.refreshLessonVideo).not.toHaveBeenCalled();
  });

  it("takes the video off and refreshes the page", async () => {
    actions.removeLessonVideo.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="ready" />);
    await user.click(screen.getByRole("button", { name: "Remove video" }));
    expect(actions.removeLessonVideo).toHaveBeenCalledWith(COURSE, LESSON);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("shows why the video could not be taken off, and when the action throws", async () => {
    const user = userEvent.setup();
    actions.removeLessonVideo.mockResolvedValueOnce({ error: "Couldn't take the video off." });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="ready" />);
    await user.click(screen.getByRole("button", { name: "Remove video" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't take the video off.");
    expect(router.refresh).not.toHaveBeenCalled();

    actions.removeLessonVideo.mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Remove video" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"));
  });

  it("checks on a video being prepared every so often, and refreshes the page once it is ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    actions.refreshLessonVideo.mockResolvedValueOnce({ status: "preparing" }).mockResolvedValueOnce({ status: "ready" });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="preparing" />);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(actions.refreshLessonVideo).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(actions.refreshLessonVideo).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("checks on request with Check again, and shows a refusal", async () => {
    actions.refreshLessonVideo.mockResolvedValue({ error: "Couldn't check on the video." });
    const user = userEvent.setup();
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="preparing" />);
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check on the video.");
  });

  it("tells the person when checking throws", async () => {
    actions.refreshLessonVideo.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="preparing" />);
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("does not keep checking on a video that failed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    render(<LessonVideoControls courseId={COURSE} lessonId={LESSON} status="errored" />);
    expect(screen.getByRole("button", { name: "Replace video" })).toBeEnabled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(actions.refreshLessonVideo).not.toHaveBeenCalled();
  });
});
