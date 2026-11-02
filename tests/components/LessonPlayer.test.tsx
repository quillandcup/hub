// @vitest-environment jsdom
/**
 * The lesson player's own logic: it hands Mux the three signed tokens, and remembers the viewer's
 * speed and captions choice. Video.js is replaced by stand-ins whose state the tests control; what
 * the real library does with a stream was checked by hand in the player spike (docs/COURSES.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  media: undefined as undefined | (EventTarget & { currentTime: number; duration: number; paused: boolean; seeking: boolean; playbackRate: number }),
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));
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
  useMedia: () => player.media,
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

import LessonPlayer from "@/components/courses/LessonPlayer";
import { LessonCompletionProvider } from "@/components/courses/LessonCompletion";
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
  player.media = undefined;
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

/** A stand-in for the video element: the tests move its clock and fire the events the browser would. */
function fakeMedia(over: Partial<{ currentTime: number; duration: number; paused: boolean; playbackRate: number }> = {}) {
  return Object.assign(new EventTarget(), { currentTime: 0, duration: 600, paused: true, seeking: false, playbackRate: 1, ...over });
}

describe("LessonPlayer watch tracking", () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
  const requests = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  // The saves of stretches and positions: not the "viewed" marker that goes out when the player appears, which has its own tests.
  const sent = () =>
    requests()
      .filter((b) => b.segments.length > 0 || b.position !== null)
      .map(({ viewed: _viewed, ...rest }) => rest);
  const tracked = () => <LessonPlayer title="T" playbackId="pb-1" tokens={tokens} lessonId="lesson-1" trackProgress />;
  const fire = (media: NonNullable<typeof player.media>, event: string) => act(() => void media.dispatchEvent(new Event(event)));
  const play = (media: NonNullable<typeof player.media>, at: number) => {
    media.currentTime = at;
    media.paused = false;
    fire(media, "playing");
  };
  const advance = (media: NonNullable<typeof player.media>, to: number) => {
    media.currentTime = to;
    fire(media, "timeupdate");
  };
  const pause = (media: NonNullable<typeof player.media>) => {
    media.paused = true;
    fire(media, "pause");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("the viewed marker", () => {
    it("goes out when the player appears, before anything is played, with no stretch and no position", async () => {
      player.media = fakeMedia();
      render(tracked());
      await act(async () => {});

      expect(requests()).toEqual([{ lessonId: "lesson-1", sessionId: expect.any(String), segments: [], position: null, viewed: true }]);
    });

    it("stops being sent once a request has been confirmed, so one view is one marker", async () => {
      const media = (player.media = fakeMedia());
      render(tracked());
      await act(async () => {});
      play(media, 0);
      advance(media, 20);
      pause(media);

      expect(requests().filter((b) => b.viewed)).toHaveLength(1);
    });

    it("rides along on the next save when the first request failed", async () => {
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
      const media = (player.media = fakeMedia());
      render(tracked());
      await act(async () => {});
      play(media, 0);
      advance(media, 20);
      pause(media);
      await act(async () => {});

      const withMarker = requests().filter((b) => b.viewed);
      expect(withMarker.length).toBeGreaterThanOrEqual(2);
      expect(new Set(withMarker.map((b) => b.sessionId)).size).toBe(1);
    });

    it("is not sent when tracking is off (sudo, a staff preview)", async () => {
      player.media = fakeMedia();
      render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} lessonId="lesson-1" />);
      await act(async () => {});
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("sends a stretch on pause, with the speed, captions state and where the playhead is", () => {
    const media = (player.media = fakeMedia({ playbackRate: 1.5 }));
    render(tracked());
    play(media, 10);
    advance(media, 40);
    pause(media);

    expect(fetchMock).toHaveBeenCalledWith("/api/courses/watch", expect.objectContaining({ method: "POST", keepalive: true }));
    expect(sent()).toEqual([
      { lessonId: "lesson-1", sessionId: expect.any(String), segments: [{ id: expect.any(String), start: 10, end: 40, rate: 1.5, captions: null, visible: true }], position: 40 },
    ]);
  });

  it("closes a stretch at a seek and starts the next where the member landed", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 20);
    fire(media, "seeking");
    media.currentTime = 100;
    fire(media, "seeked");
    advance(media, 130);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([
      { id: expect.any(String), start: 0, end: 20, rate: 1, captions: null, visible: true },
      { id: expect.any(String), start: 100, end: 130, rate: 1, captions: null, visible: true },
    ]);
  });

  it("drops a blip shorter than a quarter second", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 5);
    advance(media, 5.1);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([]);
  });

  it("splits at a speed change and carries on at the new speed", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 30);
    media.playbackRate = 2;
    fire(media, "ratechange");
    advance(media, 90);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([
      { id: expect.any(String), start: 0, end: 30, rate: 1, captions: null, visible: true },
      { id: expect.any(String), start: 30, end: 90, rate: 2, captions: null, visible: true },
    ]);
  });

  it("checkpoints a long stretch every 30 seconds so leaving loses little", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 30);
    act(() => void vi.advanceTimersByTime(30_000));

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ segments: [{ id: expect.any(String), start: 0, end: 30 }], position: 30 });
    // The stretch carries on from there.
    advance(media, 45);
    pause(media);
    expect(sent().flatMap((b) => b.segments).at(-1)).toMatchObject({ id: expect.any(String), start: 30, end: 45 });
  });

  it("sends what's pending when the page is left or the player goes away", () => {
    const media = (player.media = fakeMedia());
    const { unmount } = render(tracked());
    play(media, 0);
    advance(media, 12);
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(sent().flatMap((b) => b.segments)).toEqual([{ id: expect.any(String), start: 0, end: 12, rate: 1, captions: null, visible: true }]);

    fetchMock.mockClear();
    advance(media, 20);
    unmount();
    expect(sent()).toEqual([expect.objectContaining({ position: 20 })]);
  });

  it("reopens a stretch when the page comes back from the back/forward cache still playing", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 10);
    act(() => void window.dispatchEvent(new Event("pagehide")));
    // Restored while still playing: no `playing` event fires.
    media.currentTime = 10;
    act(() => void window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
    advance(media, 25);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([
      { id: expect.any(String), start: 0, end: 10, rate: 1, captions: null, visible: true },
      { id: expect.any(String), start: 10, end: 25, rate: 1, captions: null, visible: true },
    ]);
  });

  it("ignores a plain page load's pageshow", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    act(() => void window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false })));
    media.paused = false;
    advance(media, 5);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([]);
  });

  it("marks a stretch played in the background as not visible", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 10);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    advance(media, 25);
    pause(media);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });

    expect(sent().flatMap((b) => b.segments)).toEqual([
      { id: expect.any(String), start: 0, end: 10, rate: 1, captions: null, visible: true },
      { id: expect.any(String), start: 10, end: 25, rate: 1, captions: null, visible: false },
    ]);
  });

  it("tags a stretch with the captions language showing, by label", () => {
    player.captions = {
      state: { availability: "available", subtitlesShowing: true } as never,
      options: [{ value: "t1", label: "Spanish" }],
      value: "t1",
      setValue: vi.fn(),
    };
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 8);
    pause(media);

    expect(sent().flatMap((b) => b.segments)).toEqual([{ id: expect.any(String), start: 0, end: 8, rate: 1, captions: "Spanish", visible: true }]);
  });

  it("records nothing unless tracking is on (sudo, a staff preview)", () => {
    const media = (player.media = fakeMedia());
    render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} lessonId="lesson-1" />);
    play(media, 0);
    advance(media, 30);
    pause(media);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("when a save fails", () => {
    const stretch = (media: NonNullable<typeof player.media>, from: number, to: number) => {
      play(media, from);
      advance(media, to);
      pause(media);
    };

    it("resends the stretch with the next save after a server error or a lost connection, with the same id", async () => {
      const media = (player.media = fakeMedia());
      render(tracked());
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
      stretch(media, 0, 10);
      await act(async () => {});
      fetchMock.mockRejectedValueOnce(new TypeError("offline"));
      stretch(media, 20, 30);
      await act(async () => {});
      stretch(media, 40, 50);

      const calls = sent();
      const firstId = calls[0].segments[0].id;
      expect(calls[1].segments.map((s: { start: number }) => s.start)).toEqual([0, 20]);
      expect(calls[1].segments[0].id).toBe(firstId);
      expect(calls[2].segments.map((s: { start: number }) => s.start)).toEqual([0, 20, 40]);
      expect(calls[2].segments[0].id).toBe(firstId);
    });

    it("stops resending once a save goes through", async () => {
      const media = (player.media = fakeMedia());
      render(tracked());
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
      stretch(media, 0, 10);
      await act(async () => {});
      stretch(media, 20, 30);
      await act(async () => {});
      stretch(media, 40, 50);

      expect(sent()[2].segments.map((s: { start: number }) => s.start)).toEqual([40]);
    });

    it("drops stretches the server refused, since resending can't help", async () => {
      const media = (player.media = fakeMedia());
      render(tracked());
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
      stretch(media, 0, 10);
      await act(async () => {});
      stretch(media, 20, 30);

      expect(sent()[1].segments.map((s: { start: number }) => s.start)).toEqual([20]);
    });

    it("keeps only the newest 200 while saves keep failing, and sends them in batches the server accepts", async () => {
      const media = (player.media = fakeMedia());
      render(tracked());
      fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
      for (let i = 0; i < 210; i++) {
        stretch(media, i * 10, i * 10 + 5);
        await act(async () => {});
      }
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(new Response("{}"));
      stretch(media, 5000, 5005);
      await act(async () => {});
      await act(async () => {});
      await act(async () => {});
      await act(async () => {});

      const batches = sent().map((b) => b.segments);
      expect(batches.every((b: unknown[]) => b.length <= 50)).toBe(true);
      const starts = batches.flat().map((s: { start: number }) => s.start);
      expect(starts).toHaveLength(200);
      expect(starts.at(-1)).toBe(5000);
      expect(starts[0]).toBeGreaterThan(0);
    });
  });

  it("does not send a position it has already sent", () => {
    const media = (player.media = fakeMedia());
    render(tracked());
    play(media, 0);
    advance(media, 20);
    pause(media);
    fetchMock.mockClear();
    act(() => void window.dispatchEvent(new Event("pagehide")));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LessonPlayer resume", () => {
  const resumed = (seconds: number) => <LessonPlayer title="T" playbackId="pb-1" tokens={tokens} lessonId="lesson-1" resumeSeconds={seconds} />;

  it("starts where the member left off once the length is known", () => {
    const media = (player.media = fakeMedia({ duration: 0 }));
    render(resumed(125));
    expect(media.currentTime).toBe(0);

    media.duration = 600;
    act(() => void media.dispatchEvent(new Event("loadedmetadata")));
    expect(media.currentTime).toBe(125);
  });

  it("jumps straight away when the length is already known, and only once", () => {
    const media = (player.media = fakeMedia({ duration: 600 }));
    render(resumed(125));
    expect(media.currentTime).toBe(125);

    media.currentTime = 7;
    act(() => void media.dispatchEvent(new Event("loadedmetadata")));
    expect(media.currentTime).toBe(7);
  });

  it("starts over when they had (nearly) finished it", () => {
    const media = (player.media = fakeMedia({ duration: 600 }));
    render(resumed(580));
    expect(media.currentTime).toBe(0);
  });

  it("does nothing without a saved position", () => {
    const media = (player.media = fakeMedia({ duration: 600 }));
    render(resumed(0));
    expect(media.currentTime).toBe(0);
  });

  describe("reporting the playhead", () => {
    it("tells the page the whole second the playhead is at, as it changes", () => {
      const onTime = vi.fn();
      player.time = { currentTime: 12.9, duration: 100 };
      const { rerender } = render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} onTime={onTime} />);
      expect(onTime).toHaveBeenLastCalledWith(12);

      player.time = { currentTime: 40.2, duration: 100 };
      rerender(<LessonPlayer title="T " playbackId="pb-1" tokens={tokens} onTime={onTime} />);
      expect(onTime).toHaveBeenLastCalledWith(40);
    });

    it("reports nothing when nobody asked", () => {
      expect(() => render(ui())).not.toThrow();
    });
  });
});

describe("LessonPlayer reports what happened to the video", () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  const fire = (media: EventTarget, event: string) => act(() => void media.dispatchEvent(new Event(event)));

  beforeEach(() => {
    track.mockClear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records the first play once, and whether it picked up from a saved position", () => {
    const media = (player.media = fakeMedia());
    render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} resumeSeconds={42} />);
    fire(media, "playing");
    fire(media, "playing");
    expect(track.mock.calls.filter(([name]) => name === "course_video_played")).toEqual([["course_video_played", { resumed: true }]]);
  });

  it("says it was not a resume when it started from the beginning", () => {
    const media = (player.media = fakeMedia());
    render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} />);
    fire(media, "playing");
    expect(track).toHaveBeenCalledWith("course_video_played", { resumed: false });
  });

  it("records a playback error with the browser's code, and alerts staff once", () => {
    const media = Object.assign((player.media = fakeMedia()), { error: { code: 4 } });
    render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} />);
    fire(media, "error");
    fire(media, "error");
    expect(track.mock.calls.filter(([name]) => name === "course_video_error")).toEqual([["course_video_error", { code: 4 }]]);
    const alerts = fetchMock.mock.calls.filter(([url]) => url === "/api/client-errors");
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0][1]!.body as string)).toEqual({ path: window.location.pathname, kind: "video", message: "Playback error, code 4" });
  });

  it("reports code 0 when the browser gives none, and survives a failed report", () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const media = (player.media = fakeMedia());
    render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} />);
    expect(() => fire(media, "error")).not.toThrow();
    expect(track).toHaveBeenCalledWith("course_video_error", { code: 0 });
  });

  it("stops listening when the player goes away", () => {
    const media = (player.media = fakeMedia());
    const { unmount } = render(<LessonPlayer title="T" playbackId="pb-1" tokens={tokens} />);
    unmount();
    fire(media, "playing");
    expect(track.mock.calls.filter(([name]) => name === "course_video_played")).toEqual([]);
  });
});
