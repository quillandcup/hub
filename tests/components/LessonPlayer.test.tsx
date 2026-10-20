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
  playback: { started: false, play: vi.fn() } as { started: boolean; play: () => void },
}));

vi.mock("@videojs/react", () => ({
  selectPlayback: "playback",
  selectPlaybackRate: "rate",
  selectSource: "source",
  usePlayer: (selector: string) => {
    if (selector === "rate") return player.rate;
    if (selector === "playback") return player.playback;
    return { canPlay: player.canPlay };
  },
  useCaptionsOptions: () => player.captions,
}));
vi.mock("@videojs/react/video", () => ({
  VideoPlayer: ({ children, title }: { children: React.ReactNode; title: string }) => <div data-testid="player" data-title={title}>{children}</div>,
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

const tokens = { playback: "tok-play", poster: "tok-poster", storyboard: "tok-board" };
// A new element each time: re-rendering the identical one would be skipped, and the stand-in hooks never re-run.
const ui = () => <LessonPlayer title="Your writing space" playbackId="pb-1" tokens={tokens} />;

beforeEach(() => {
  localStorage.clear();
  player.rate = { playbackRate: 1, setPlaybackRate: vi.fn() };
  player.canPlay = false;
  player.captions = undefined;
  player.muxSource = undefined;
  player.playback = { started: false, play: vi.fn() };
});

describe("LessonPlayer", () => {
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

    it("is gone once playback has started", () => {
      player.playback = { started: true, play: vi.fn() };
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
