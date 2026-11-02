// @vitest-environment jsdom
/** The captions of a Hub-owned lesson's video: the tracks, a file to add, automatic captions and Remove. The actions are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ addLessonCaptions: vi.fn(), generateLessonCaptions: vi.fn(), removeLessonCaptions: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/lesson-caption-actions", () => actions);

import LessonCaptions from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonCaptions";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const TRACK = "00000000-0000-4000-a000-000000000001";
const tracks = [
  { id: TRACK, label: "English", language: "en", kind: "captions", source: "manual" },
  { id: "00000000-0000-4000-a000-000000000002", label: "Spanish (automatic)", language: "es", kind: "subtitles", source: "mux_auto" },
];
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello\n";
const file = (name = "english.vtt", text = VTT) => new File([text], name, { type: "text/vtt" });
const choose = (f: File) => fireEvent.change(screen.getByLabelText("Choose a caption file"), { target: { files: [f] } });

beforeEach(() => {
  vi.clearAllMocks();
  actions.addLessonCaptions.mockResolvedValue({ id: LESSON });
  actions.generateLessonCaptions.mockResolvedValue({ id: LESSON });
  actions.removeLessonCaptions.mockResolvedValue({ id: TRACK });
});

describe("the tracks", () => {
  it("says when there are none", () => {
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    expect(screen.getByText("No captions on this video yet.")).toBeInTheDocument();
  });

  it("lists each with its language and where it came from, and a Remove for it", () => {
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={tracks} />);
    const list = within(screen.getByRole("list"));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText(/English · Uploaded/)).toBeInTheDocument();
    expect(list.getByText(/Spanish · Automatic/)).toBeInTheDocument();
    expect(list.getByText("Spanish (automatic)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove English" })).toBeEnabled();
  });

  it("removes a track and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={tracks} />);
    await user.click(screen.getByRole("button", { name: "Remove English" }));

    expect(actions.removeLessonCaptions).toHaveBeenCalledWith(COURSE, LESSON, TRACK);
    expect(await screen.findByRole("status")).toHaveTextContent("Removed English.");
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("adding a file", () => {
  it("sends the file's text with the chosen language and name, says it worked, and refreshes", async () => {
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    await user.selectOptions(screen.getByLabelText("Language"), "es");
    await user.type(screen.getByLabelText("Name"), "Español");
    choose(file("es.vtt"));

    await waitFor(() => expect(actions.addLessonCaptions).toHaveBeenCalledWith(COURSE, LESSON, { language: "es", label: "Español", text: VTT }));
    expect(await screen.findByRole("status")).toHaveTextContent("Captions added.");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("offers English first, and shows the language as the name's placeholder", () => {
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "English");
  });

  it("shows why a file was refused, without refreshing", async () => {
    actions.addLessonCaptions.mockResolvedValue({ error: "That doesn't look like a caption file. Use a WebVTT (.vtt) or SubRip (.srt) file." });
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    choose(file("notes.txt", "Hello there"));

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like a caption file");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("turns a file that is too large away without sending it", async () => {
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    choose(new File([new Uint8Array(800_001)], "huge.vtt"));

    expect(await screen.findByRole("alert")).toHaveTextContent("too large for captions");
    expect(actions.addLessonCaptions).not.toHaveBeenCalled();
  });

  it("tells the person when the action throws", async () => {
    actions.addLessonCaptions.mockRejectedValue(new Error("boom"));
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    choose(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("opens the file chooser from the button, and does nothing when no file is chosen", async () => {
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    const clicked = vi.fn();
    screen.getByLabelText("Choose a caption file").addEventListener("click", clicked);
    await user.click(screen.getByRole("button", { name: "Upload captions" }));
    expect(clicked).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Choose a caption file"), { target: { files: [] } });
    expect(actions.addLessonCaptions).not.toHaveBeenCalled();
  });
});

describe("automatic captions", () => {
  it("asks Mux for the chosen language, and says they will appear when it has finished", async () => {
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={[]} />);
    await user.selectOptions(screen.getByLabelText("Language"), "fr");
    await user.click(screen.getByRole("button", { name: "Make captions automatically" }));

    expect(actions.generateLessonCaptions).toHaveBeenCalledWith(COURSE, LESSON, "fr");
    expect(await screen.findByRole("status")).toHaveTextContent("Mux is writing the captions.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows why it could not", async () => {
    actions.generateLessonCaptions.mockResolvedValue({ error: "English already has captions. Remove them first to make new ones." });
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={tracks} />);
    await user.click(screen.getByRole("button", { name: "Make captions automatically" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("English already has captions");
  });

  it("turns every button off while a change is on its way", async () => {
    let finish: (v: { id: string }) => void = () => undefined;
    actions.generateLessonCaptions.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<LessonCaptions courseId={COURSE} lessonId={LESSON} tracks={tracks} />);
    await user.click(screen.getByRole("button", { name: "Make captions automatically" }));

    expect(screen.getByRole("button", { name: "Asking Mux…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload captions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove English" })).toBeDisabled();
    finish({ id: LESSON });
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload captions" })).toBeEnabled());
  });
});
