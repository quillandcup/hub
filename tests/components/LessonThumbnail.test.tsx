// @vitest-environment jsdom
/** A Hub-owned lesson's thumbnail: the picker card and the "use this frame" button. The actions and the shared image picker are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const outline = vi.hoisted(() => ({ setLessonThumbnail: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => outline);
const video = vi.hoisted(() => ({ setLessonThumbnailFromVideo: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/lesson-video-actions", () => video);

// The shared picker has its own tests: here it only hands over what is chosen, and shows what it was given.
type PickerProps = { value: string | null; onChange: (id: string | null) => Promise<string | null | void> | string | null | void; surface: string; adjustable?: boolean; noun?: string };
const picker = vi.hoisted(() => ({ last: null as null | PickerProps }));
vi.mock("@/components/media/MediaPicker", () => ({
  default: (props: PickerProps) => {
    picker.last = props;
    return (
      <div data-testid="picker" data-value={props.value ?? ""} data-surface={props.surface} data-adjustable={String(props.adjustable)}>
        <button type="button" onClick={() => void props.onChange("media_BBBBBBBBBBB2")}>
          pick
        </button>
        <button type="button" onClick={() => void props.onChange(null)}>
          clear
        </button>
      </div>
    );
  },
}));

import LessonThumbnailField from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonThumbnailField";
import FrameThumbnailButton from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/FrameThumbnailButton";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LessonThumbnailField", () => {
  it("is the shared image picker for lesson thumbnails, showing the chosen image whole (no crop to adjust)", () => {
    render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId="media_AAAAAAAAAAA1" currentSrc="/api/courses/image/lesson/x" />);
    const el = screen.getByTestId("picker");
    expect(el).toHaveAttribute("data-value", "media_AAAAAAAAAAA1");
    expect(el).toHaveAttribute("data-surface", "lesson_thumbnail");
    expect(el).toHaveAttribute("data-adjustable", "false");
    expect(picker.last?.noun).toBe("thumbnail");
  });

  it("shows Kajabi's picture until an image is chosen, and not once there is one", () => {
    const { rerender } = render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId={null} currentSrc="https://example.com/kajabi.jpg" />);
    expect(document.querySelector('img[src="https://example.com/kajabi.jpg"]')).not.toBeNull();
    rerender(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId="media_AAAAAAAAAAA1" currentSrc="https://example.com/kajabi.jpg" />);
    expect(document.querySelector('img[src="https://example.com/kajabi.jpg"]')).toBeNull();
  });

  it("saves the image that is picked for this lesson, shows it, and refreshes the page", async () => {
    outline.setLessonThumbnail.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId={null} currentSrc={null} />);
    await user.click(screen.getByRole("button", { name: "pick" }));

    expect(outline.setLessonThumbnail).toHaveBeenCalledWith(COURSE, LESSON, "media_BBBBBBBBBBB2");
    await waitFor(() => expect(screen.getByTestId("picker")).toHaveAttribute("data-value", "media_BBBBBBBBBBB2"));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("clears the thumbnail when the picker is cleared", async () => {
    outline.setLessonThumbnail.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId="media_AAAAAAAAAAA1" currentSrc={null} />);
    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(outline.setLessonThumbnail).toHaveBeenCalledWith(COURSE, LESSON, null);
    await waitFor(() => expect(screen.getByTestId("picker")).toHaveAttribute("data-value", ""));
  });

  it("hands the reason back to the picker when the save is refused, and keeps what was shown", async () => {
    outline.setLessonThumbnail.mockResolvedValue({ error: "That image isn't in the library any more. Choose another." });
    render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId="media_AAAAAAAAAAA1" currentSrc={null} />);
    await expect(picker.last!.onChange("media_BBBBBBBBBBB2")).resolves.toBe("That image isn't in the library any more. Choose another.");
    expect(screen.getByTestId("picker")).toHaveAttribute("data-value", "media_AAAAAAAAAAA1");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("hands back a message when the action throws", async () => {
    outline.setLessonThumbnail.mockRejectedValue(new Error("boom"));
    render(<LessonThumbnailField courseId={COURSE} lessonId={LESSON} assetId={null} currentSrc={null} />);
    await expect(picker.last!.onChange("media_BBBBBBBBBBB2")).resolves.toMatch(/Something went wrong/);
  });
});

describe("FrameThumbnailButton", () => {
  it("says which moment it would use", () => {
    render(<FrameThumbnailButton courseId={COURSE} lessonId={LESSON} seconds={75} />);
    expect(screen.getByRole("button", { name: "Use the frame at 1:15 as the thumbnail" })).toBeEnabled();
  });

  it("makes the thumbnail from the player's moment, says so, and refreshes the page", async () => {
    video.setLessonThumbnailFromVideo.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<FrameThumbnailButton courseId={COURSE} lessonId={LESSON} seconds={75.4} />);
    await user.click(screen.getByRole("button"));

    expect(video.setLessonThumbnailFromVideo).toHaveBeenCalledWith(COURSE, LESSON, 75.4);
    expect(await screen.findByRole("status")).toHaveTextContent("Thumbnail set from 1:15.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows why it could not, without refreshing", async () => {
    video.setLessonThumbnailFromVideo.mockResolvedValue({ error: "The video isn't ready yet." });
    const user = userEvent.setup();
    render(<FrameThumbnailButton courseId={COURSE} lessonId={LESSON} seconds={5} />);
    await user.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The video isn't ready yet.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("tells the person when the action throws", async () => {
    video.setLessonThumbnailFromVideo.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<FrameThumbnailButton courseId={COURSE} lessonId={LESSON} seconds={5} />);
    await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
