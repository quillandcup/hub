// @vitest-environment jsdom
/** The downloads of a Hub-owned lesson: the list, Add files and Remove. The actions and the storage upload are faked; what is tested is what is asked for and shown. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ startLessonFileUpload: vi.fn(), finishLessonFileUpload: vi.fn(), removeLessonFile: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/lesson-file-actions", () => actions);
const storage = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: (bucket: string) => (storage.from(bucket), { uploadToSignedUrl: storage.uploadToSignedUrl }) } }) }));

import LessonFilesField from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonFilesField";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const FILE = "file_AAAAAAAAAAA1";
const pdf = (name: string) => new File(["x"], name, { type: "application/pdf" });
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Choose files to add"), { target: { files } });

beforeEach(() => {
  vi.clearAllMocks();
  actions.startLessonFileUpload.mockImplementation(async (_c: string, _l: string, f: { filename: string }) => ({ fileKey: `up-${f.filename}`, path: `p/${f.filename}`, token: "tok" }));
  actions.finishLessonFileUpload.mockResolvedValue({ id: LESSON });
  storage.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
});

describe("the list", () => {
  it("says there are no downloads, and offers Add files", () => {
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    expect(screen.getByText("No downloads.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add files" })).toBeEnabled();
  });

  it("lists each file with its size and a Remove for it", () => {
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[{ id: FILE, filename: "Tracker.pdf", sizeBytes: 2048 }]} />);
    expect(screen.getByText("Tracker.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Tracker.pdf" })).toBeEnabled();
  });

  it("opens the file chooser from the button", async () => {
    const user = userEvent.setup();
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    const clicked = vi.fn();
    screen.getByLabelText("Choose files to add").addEventListener("click", clicked);
    await user.click(screen.getByRole("button", { name: "Add files" }));
    expect(clicked).toHaveBeenCalled();
  });
});

describe("adding files", () => {
  it("asks for an address for each file, sends it there, says it arrived, and refreshes the page", async () => {
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose(pdf("One.pdf"), pdf("Two.pdf"));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(actions.startLessonFileUpload).toHaveBeenNthCalledWith(1, COURSE, LESSON, { filename: "One.pdf", size: 1 });
    expect(actions.startLessonFileUpload).toHaveBeenNthCalledWith(2, COURSE, LESSON, { filename: "Two.pdf", size: 1 });
    expect(storage.from).toHaveBeenCalledWith("course-files");
    expect(storage.uploadToSignedUrl).toHaveBeenCalledWith("p/One.pdf", "tok", expect.any(File), { contentType: "application/pdf" });
    expect(actions.finishLessonFileUpload).toHaveBeenCalledWith(COURSE, LESSON, { fileKey: "up-One.pdf", filename: "One.pdf", type: "application/pdf" });
    expect(actions.finishLessonFileUpload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the file that failed, and still sends the others", async () => {
    actions.startLessonFileUpload.mockImplementationOnce(async () => ({ error: "That file is larger than 50 MB." }));
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose(pdf("Huge.pdf"), pdf("Fine.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Huge.pdf: That file is larger than 50 MB.");
    expect(actions.finishLessonFileUpload).toHaveBeenCalledTimes(1);
    expect(actions.finishLessonFileUpload).toHaveBeenCalledWith(COURSE, LESSON, expect.objectContaining({ filename: "Fine.pdf" }));
  });

  it("says why the storage upload failed, and records nothing", async () => {
    storage.uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "Payload too large" } });
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose(pdf("One.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent("One.pdf: Payload too large");
    expect(actions.finishLessonFileUpload).not.toHaveBeenCalled();
  });

  it("shows the reason the lesson would not record a file that arrived", async () => {
    actions.finishLessonFileUpload.mockResolvedValue({ error: "Couldn't save the file." });
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose(pdf("One.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("One.pdf: Couldn't save the file.");
  });

  it("reports a file when something throws", async () => {
    actions.startLessonFileUpload.mockRejectedValue(new Error("boom"));
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose(pdf("One.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("One.pdf: something went wrong.");
  });

  it("does nothing when no file is chosen", () => {
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[]} />);
    choose();
    expect(actions.startLessonFileUpload).not.toHaveBeenCalled();
  });
});

describe("removing a file", () => {
  const files = [{ id: FILE, filename: "Tracker.pdf", sizeBytes: 2048 }];

  it("removes that file and refreshes the page", async () => {
    actions.removeLessonFile.mockResolvedValue({ id: FILE });
    const user = userEvent.setup();
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={files} />);
    await user.click(screen.getByRole("button", { name: "Remove Tracker.pdf" }));
    expect(actions.removeLessonFile).toHaveBeenCalledWith(COURSE, LESSON, FILE);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("shows why it could not be removed, and when the action throws", async () => {
    const user = userEvent.setup();
    actions.removeLessonFile.mockResolvedValueOnce({ error: "Couldn't remove the file." });
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={files} />);
    await user.click(screen.getByRole("button", { name: "Remove Tracker.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tracker.pdf: Couldn't remove the file.");
    expect(router.refresh).not.toHaveBeenCalled();

    actions.removeLessonFile.mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Remove Tracker.pdf" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tracker.pdf: something went wrong."));
  });

  it("does not try to remove a file without an id", async () => {
    const user = userEvent.setup();
    render(<LessonFilesField courseId={COURSE} lessonId={LESSON} files={[{ id: null, filename: "Kajabi.pdf", sizeBytes: null }]} />);
    await user.click(screen.getByRole("button", { name: "Remove Kajabi.pdf" }));
    expect(actions.removeLessonFile).not.toHaveBeenCalled();
  });
});
