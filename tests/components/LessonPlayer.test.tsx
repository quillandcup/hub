// @vitest-environment jsdom
/**
 * The lesson player's own logic: it hands Mux the three signed tokens, and remembers the viewer's
 * speed and captions choice. Video.js is replaced by stand-ins whose state the tests control; what
 * the real library does with a stream was checked by hand in the player spike (docs/COURSES.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const player = vi.hoisted(() => ({
  rate: { playbackRate: 1, setPlaybackRate: undefined as undefined | ((r: number) => void) },
  canPlay: false,
  captions: undefined as
    | undefined
    | {
        state: { availability: string };
        options: { value: string; label: string }[];
        value: string;
        setValue: (v: string) => void;
      },
  muxSource: undefined as unknown,
  playback: { started: false, paused: true, play: vi.fn() } as { started: boolean; paused: boolean; play: () => void },
  time: { currentTime: 0, duration: 0 },
}));

vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn(async () => ({})) }));
vi.mock("@videojs/react", () => ({
  selectPlayback: "playback",
  selectPlaybackRate: "rate",
  selectSource: "source",
  selectTime: "time",
  usePlayer: (selector: string) => {
    if (selector === "rate") return player.rate;
    if (selector === "playback") return player.playback;
    if (selector === "time") return player.time;
    return { canPlay: player.canPlay };
  },
  useCaptionsOptions: () => player.captions,
}));
vi.mock("@videojs/react/video", () => ({
  VideoPlayer: ({ children, title, poster }: { children: React.ReactNode; title: string; poster?: string }) => (
    <div data-testid="player" data-title={title} data-poster={poster}>
      {children}
    </div>
  ),
  VideoSkin: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@videojs/react/media/mux-video", () => ({
  MuxVideo: ({ source }: { source: unknown }) => {
    player.muxSource = source;
    return <video data-testid="video" />;
  },
}));
vi.mock("@videojs/react/video/skin.css", () => ({}));

import LessonPlayer from "@/app/(member)/courses/LessonPlayer";
import { LessonCompletionProvider } from "@/app/(member)/courses/LessonCompletion";
import { setLessonComplete } from "@/app/(member)/courses/actions";

const tokens = { playback: "tok-play", poster: "tok-poster", storyboard: "tok-board" };
// A new element each time: re-rendering the identical one would be skipped, and the stand-in hooks never re-run.
const ui = () => <LessonPlayer title="Your writing space" playbackId="pb-1" tokens={tokens} />;

beforeEach(() => {
  localStorage.clear();
  player.rate = { playbackRate: 1, setPlaybackRate: vi.fn() };
  player.canPlay = false;
  player.captions = undefined;
  player.muxSource = undefined;
  player.playback = { started: false, paused: true, play: vi.fn() };
  player.time = { currentTime: 0, duration: 0 };
  vi.mocked(setLessonComplete).mockClear();
});

describe("LessonPlayer", () => {
  describe("poster and title", () => {
    it("uses the lesson's thumbnail as the poster, and doesn't ask Mux for a frame", () => {
      render(<LessonPlayer title="Your writing space" playbackId="pb-1" tokens={tokens} posterUrl="https://cdn.test/lesson.jpg" />);

      expect(screen.getByTestId("player")).toHaveAttribute("data-poster", "https://cdn.test/lesson.jpg");
      expect(player.muxSource).toEqual({
        playbackId: "pb-1",
        playback: { token: "tok-play" },
        storyboard: { format: "webp", token: "tok-board" },
      });
    });

    it("falls back to a frame of the video when the lesson has no thumbnail, or an unsafe one", () => {
      const { unmount } = render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} posterUrl={null} />);
      expect(screen.getByTestId("player")).not.toHaveAttribute("data-poster");
      expect(player.muxSource).toMatchObject({ poster: { time: 2, token: "tok-poster" } });
      unmount();

      render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} posterUrl="javascript:alert(1)" />);
      expect(screen.getByTestId("player")).not.toHaveAttribute("data-poster");
      expect(player.muxSource).toMatchObject({ poster: { time: 2, token: "tok-poster" } });
    });

    it("hides the skin's title overlay (the page already shows the title) but keeps it as the player's accessible name", () => {
      render(ui());
      const group = screen.getByRole("group", { name: "Your writing space" });

      expect(group).toHaveClass("[&_.media-title]:hidden");
      expect(group).toContainElement(screen.getByTestId("player"));
    });
  });

  describe("completing at the watched mark", () => {
    const withCompletion = (over: { initiallyCompleted?: boolean; readOnlyReason?: string | null } = {}) => (
      <LessonCompletionProvider lessonId="l1" initiallyCompleted={over.initiallyCompleted ?? false} readOnlyReason={over.readOnlyReason ?? null}>
        <LessonPlayer title="Your writing space" playbackId="pb-1" tokens={tokens} />
      </LessonCompletionProvider>
    );
    const watching = (fraction: number, over: Partial<typeof player.playback> = {}) => {
      player.playback = { started: true, paused: false, play: vi.fn(), ...over };
      player.time = { currentTime: fraction * 600, duration: 600 };
    };

    it("completes the lesson once the playhead passes 90% while playing", () => {
      watching(0.91);
      render(withCompletion());

      expect(setLessonComplete).toHaveBeenCalledTimes(1);
      expect(setLessonComplete).toHaveBeenCalledWith("l1", true);
    });

    it("does nothing before the mark", () => {
      watching(0.89);
      render(withCompletion());

      expect(setLessonComplete).not.toHaveBeenCalled();
    });

    it("does not count a paused playhead (jumping to the end without playing)", () => {
      watching(0.99, { paused: true });
      render(withCompletion());

      expect(setLessonComplete).not.toHaveBeenCalled();
    });

    it("does not count a video that hasn't started, or has no known length yet", () => {
      player.playback = { started: false, paused: false, play: vi.fn() };
      player.time = { currentTime: 0, duration: 0 };
      render(withCompletion());

      expect(setLessonComplete).not.toHaveBeenCalled();
    });

    it("leaves a lesson that's already complete alone, and one that's read-only (a preview)", () => {
      watching(0.95);
      const { unmount } = render(withCompletion({ initiallyCompleted: true }));
      expect(setLessonComplete).not.toHaveBeenCalled();
      unmount();

      render(withCompletion({ readOnlyReason: "preview" }));
      expect(setLessonComplete).not.toHaveBeenCalled();
    });

    it("plays fine outside a completion provider", () => {
      watching(0.95);
      render(ui());

      expect(screen.getByTestId("player")).toBeInTheDocument();
      expect(setLessonComplete).not.toHaveBeenCalled();
    });
  });

  it("gives Mux the playback id and a token for the stream, the poster and the seek previews", () => {
    render(ui());

    expect(screen.getByTestId("player")).toHaveAttribute("data-title", "Your writing space");
    expect(player.muxSource).toEqual({
      playbackId: "pb-1",
      playback: { token: "tok-play" },
      poster: { time: 2, token: "tok-poster" },
      storyboard: { format: "webp", token: "tok-board" },
    });
  });

  describe("big play button", () => {
    it("shows a labelled play button over the poster before the first play, and plays on click", async () => {
      render(ui());
      await userEvent.click(screen.getByRole("button", { name: "Play video" }));

      expect(player.playback.play).toHaveBeenCalledTimes(1);
    });

    it("is large (and larger on bigger screens), so it reads as the way in rather than a control", () => {
      render(ui());
      const badge = screen.getByRole("button", { name: "Play video" }).firstElementChild as HTMLElement;

      expect(badge).toHaveClass("h-20", "w-28", "sm:h-24", "sm:w-36", "lg:h-28", "lg:w-40");
      expect(badge.querySelector("svg")).toHaveClass("h-11", "w-11", "lg:h-16", "lg:w-16");
    });

    it("is gone once playback has started", () => {
      player.playback = { started: true, paused: false, play: vi.fn() };
      render(ui());

      expect(screen.queryByRole("button", { name: "Play video" })).not.toBeInTheDocument();
    });
  });

  describe("speed", () => {
    it("restores the saved speed once the video can play, and not before", () => {
      localStorage.setItem("course-player:playback-rate", "1.5");
      const { rerender } = render(ui());
      expect(player.rate.setPlaybackRate).not.toHaveBeenCalled();

      player.canPlay = true;
      rerender(ui());
      expect(player.rate.setPlaybackRate).toHaveBeenCalledWith(1.5);
      // The old value stays until the player reports the new one.
      expect(localStorage.getItem("course-player:playback-rate")).toBe("1.5");
    });

    it("saves each later change, once the restore has landed", () => {
      localStorage.setItem("course-player:playback-rate", "1.5");
      player.canPlay = true;
      const { rerender } = render(ui());

      player.rate = { ...player.rate, playbackRate: 1.5 };
      rerender(ui());
      player.rate = { ...player.rate, playbackRate: 2 };
      rerender(ui());

      expect(localStorage.getItem("course-player:playback-rate")).toBe("2");
    });

    it("leaves the speed alone when none was saved, and saves the first change", () => {
      player.canPlay = true;
      const { rerender } = render(ui());
      expect(player.rate.setPlaybackRate).not.toHaveBeenCalled();

      player.rate = { ...player.rate, playbackRate: 1.25 };
      rerender(ui());
      expect(localStorage.getItem("course-player:playback-rate")).toBe("1.25");
    });
  });

  describe("captions", () => {
    const captions = (value: string, setValue = vi.fn()) => ({
      state: { availability: "available" },
      options: [
        { value: "off", label: "Off" },
        { value: "en", label: "English" },
      ],
      value,
      setValue,
    });

    it("restores the saved choice by its label", () => {
      localStorage.setItem("course-player:captions", "English");
      const setValue = vi.fn();
      player.canPlay = true;
      player.captions = captions("off", setValue);
      render(ui());

      expect(setValue).toHaveBeenCalledWith("en");
    });

    it("saves what the viewer picks afterwards", () => {
      player.canPlay = true;
      player.captions = captions("off");
      const { rerender } = render(ui());
      expect(localStorage.getItem("course-player:captions")).toBeNull();

      player.captions = captions("en");
      rerender(ui());
      expect(localStorage.getItem("course-player:captions")).toBe("English");
    });

    it("does nothing while the video can't play yet or has no captions", () => {
      localStorage.setItem("course-player:captions", "English");
      const setValue = vi.fn();
      player.captions = captions("off", setValue);
      const { rerender } = render(ui());
      expect(setValue).not.toHaveBeenCalled();

      player.canPlay = true;
      player.captions = { ...captions("off", setValue), state: { availability: "unavailable" } };
      rerender(ui());
      expect(setValue).not.toHaveBeenCalled();
    });
  });
});
