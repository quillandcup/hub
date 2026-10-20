// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SESSION_IDLE_MS, flush, setTrackingEnabled } from "@/lib/analytics/client";
import { startImpressions } from "@/lib/analytics/impressions";

/** A stand-in for IntersectionObserver that lets a test decide what is on screen. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  /** Reports `el` as `ratio` visible (of a 1000px-tall screen, `height` px of it showing). */
  show(el: Element, ratio: number, opts: { height?: number } = {}) {
    const rect = { height: opts.height ?? 0 } as DOMRectReadOnly;
    this.callback(
      [{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: rect, rootBounds: { height: 1000 } as DOMRectReadOnly } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const io = () => FakeIntersectionObserver.instances.at(-1)!;

describe("impressions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/members/42");
    sessionStorage.clear();
    setTrackingEnabled(true);
  });

  afterEach(() => {
    stop?.();
    setTrackingEnabled(false);
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function seen() {
    await flush();
    return fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events as { event: string; properties: Record<string, unknown> }[]);
  }

  it("records a named control once it is at least half on screen, by name and route template only", async () => {
    document.body.innerHTML = `<button data-track="save-goal">Save goal</button>`;
    stop = startImpressions();
    const el = document.querySelector("button")!;
    expect(io().observed.has(el)).toBe(true);

    io().show(el, 0.2);
    expect(await seen()).toEqual([]);

    io().show(el, 0.6);
    expect(await seen()).toEqual([expect.objectContaining({ event: "element_seen", properties: { name: "save-goal", route: "/members/[id]" } })]);
    expect(io().observed.has(el)).toBe(false);
  });

  it("counts a control taller than the screen once half the screen shows it", async () => {
    document.body.innerHTML = `<section data-track="long-list"></section>`;
    stop = startImpressions();
    io().show(document.querySelector("section")!, 0.3, { height: 600 });
    expect((await seen()).map((e) => e.properties.name)).toEqual(["long-list"]);
  });

  it("ignores controls without a name, and those inside data-track-ignore", async () => {
    document.body.innerHTML = `<button>Plain</button><div data-track-ignore><button data-track="hidden-one">x</button></div>`;
    stop = startImpressions();
    expect(io().observed.size).toBe(0);
  });

  it("records a name once per visit even when it appears many times", async () => {
    document.body.innerHTML = `<a data-track="nav-home" href="/a">A</a><a data-track="nav-home" href="/b">B</a>`;
    stop = startImpressions();
    const [first, second] = Array.from(document.querySelectorAll("a"));
    io().show(first, 1);
    io().show(second, 1);
    expect(await seen()).toHaveLength(1);
  });

  it("does not repeat a name after a reload within the same visit", async () => {
    document.body.innerHTML = `<button data-track="save-goal">Save</button>`;
    stop = startImpressions();
    io().show(document.querySelector("button")!, 1);
    expect(await seen()).toHaveLength(1);
    stop();

    fetchMock.mockClear();
    stop = startImpressions();
    // Remembered: not even watched.
    expect(io().observed.size).toBe(0);
    expect(await seen()).toEqual([]);
  });

  it("picks up controls added later, and controls renamed in place", async () => {
    stop = startImpressions();
    const added = document.createElement("button");
    added.setAttribute("data-track", "late-one");
    document.body.appendChild(added);
    await Promise.resolve();
    expect(io().observed.has(added)).toBe(true);

    io().show(added, 1);
    expect((await seen()).map((e) => e.properties.name)).toEqual(["late-one"]);

    added.setAttribute("data-track", "renamed-one");
    await Promise.resolve();
    expect(io().observed.has(added)).toBe(true);
    io().show(added, 1);
    expect((await seen()).map((e) => e.properties.name)).toEqual(["late-one", "renamed-one"]);
  });

  it("starts counting afresh in a new visit after a long idle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    try {
      document.body.innerHTML = `<button data-track="first-one">A</button><button data-track="second-one">B</button>`;
      stop = startImpressions();
      const [a, b] = Array.from(document.querySelectorAll("button"));
      io().show(a, 1);
      vi.setSystemTime(Date.now() + SESSION_IDLE_MS + 1);
      io().show(b, 1);

      await flush();
      const events = fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events as { sessionId: string; properties: { name: string } }[]);
      expect(events.map((e) => e.properties.name)).toEqual(["first-one", "second-one"]);
      expect(events[1].sessionId).not.toBe(events[0].sessionId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without IntersectionObserver or when tracking is off", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    document.body.innerHTML = `<button data-track="save-goal">Save</button>`;
    expect(() => (stop = startImpressions())).not.toThrow();
    expect(await seen()).toEqual([]);

    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    setTrackingEnabled(false);
    stop = startImpressions();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });
});
