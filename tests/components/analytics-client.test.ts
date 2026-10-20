// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SESSION_IDLE_MS, flush, setTrackingEnabled, track } from "@/lib/analytics/client";
import { startAutocapture } from "@/lib/analytics/autocapture";

function sentEvents(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body).events as {
    event: string;
    sessionId: string;
    messageId: string;
    properties: Record<string, unknown>;
    context: { route: string | null };
  }[];
}

describe("track / flush", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/members/42");
    sessionStorage.clear();
  });

  afterEach(() => {
    setTrackingEnabled(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("records nothing until tracking is enabled", async () => {
    track("onair_member_clicked", { room_size: 1 });
    setTrackingEnabled(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends queued events in one batch after the interval", async () => {
    setTrackingEnabled(true);
    track("onair_member_clicked", { room_size: 1 });
    track("onair_prickle_clicked", { room_size: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const events = sentEvents(fetchMock);
    expect(events.map((e) => e.event)).toEqual(["onair_member_clicked", "onair_prickle_clicked"]);
    expect(events[0].context.route).toBe("/members/[id]");
    expect(events[0].messageId).not.toBe(events[1].messageId);
  });

  it("keeps one session within a visit and starts another after 30 idle minutes", async () => {
    setTrackingEnabled(true);
    track("onair_member_clicked", { room_size: 1 });
    vi.setSystemTime(Date.now() + 60_000);
    track("onair_member_clicked", { room_size: 1 });
    vi.setSystemTime(Date.now() + SESSION_IDLE_MS + 1);
    track("onair_member_clicked", { room_size: 1 });
    await flush();
    const [a, b, c] = sentEvents(fetchMock);
    expect(a.sessionId).toBe(b.sessionId);
    expect(c.sessionId).not.toBe(a.sessionId);
  });

  it("re-queues a batch the server failed on, and drops one it refused", async () => {
    setTrackingEnabled(true);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    track("onair_member_clicked", { room_size: 1 });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEvents(fetchMock, 1)).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    track("onair_member_clicked", { room_size: 1 });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops and forgets the queue when disabled", async () => {
    setTrackingEnabled(true);
    track("onair_member_clicked", { room_size: 1 });
    setTrackingEnabled(false);
    setTrackingEnabled(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("autocapture", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/dashboard");
    setTrackingEnabled(true);
    stop = startAutocapture();
    // jsdom can't navigate; the capture listener has already run by the time this one does.
    document.addEventListener("click", (e) => e.preventDefault());
  });

  afterEach(() => {
    stop();
    setTrackingEnabled(false);
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function captured() {
    await flush();
    return fetchMock.mock.calls.length ? sentEvents(fetchMock) : [];
  }

  it("records a button's kind, name and label", async () => {
    document.body.innerHTML = `<button data-track="save-goal">Save   goal</button>`;
    document.querySelector("button")!.click();
    expect((await captured())[0]).toMatchObject({
      event: "element_clicked",
      properties: { element: "button", name: "save-goal", text: "Save goal", route: "/dashboard" },
    });
  });

  it("records an internal link's destination as a template but not its text", async () => {
    document.body.innerHTML = `<a href="/members/42">Fern Quillsby</a>`;
    document.querySelector("a")!.click();
    const [event] = await captured();
    expect(event.properties).toEqual({ element: "link", route: "/dashboard", target_route: "/members/[id]" });
  });

  it("keeps an external link's label but not its address", async () => {
    document.body.innerHTML = `<a href="https://zoom.example/j/123">Join on Zoom</a>`;
    document.querySelector("a")!.click();
    const [event] = await captured();
    expect(event.properties).toEqual({ element: "link", route: "/dashboard", text: "Join on Zoom" });
  });

  it("keeps a navigation link's label, since it names a place and not a person", async () => {
    document.body.innerHTML = `<a href="/my-prickles">My Prickles</a>`;
    document.querySelector("a")!.click();
    expect((await captured())[0].properties).toEqual({
      element: "link",
      route: "/dashboard",
      text: "My Prickles",
      target_route: "/my-prickles",
    });
  });

  it("prefers an aria-label, and names an icon button by it", async () => {
    document.body.innerHTML = `<button aria-label="Collapse sidebar"><svg></svg></button>`;
    document.querySelector("button")!.click();
    expect((await captured())[0].properties).toMatchObject({ element: "button", text: "Collapse sidebar" });
  });

  it("names a field by its label or name, never its value or options", async () => {
    document.body.innerHTML = `
      <label for="days">Window</label>
      <select id="days" name="days"><option>Last 7 days</option><option selected>Last 30 days</option></select>
      <input type="checkbox" name="remember-me" />
      <input type="radio" id="r" value="secret-value" />`;
    document.querySelector("select")!.click();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    document.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
    const events = await captured();
    expect(events[0].properties).toEqual({ element: "input", route: "/dashboard", name: "days", text: "Window" });
    expect(events[1].properties).toEqual({ element: "input", route: "/dashboard", text: "remember-me" });
    expect(events[2].properties).toEqual({ element: "input", route: "/dashboard", name: "r" });
  });

  it("labels other controls such as tabs by their text", async () => {
    document.body.innerHTML = `<div role="tab">Notifications</div>`;
    document.querySelector("div")!.click();
    expect((await captured())[0].properties).toMatchObject({ element: "other", text: "Notifications" });
  });

  it("reaches a button from a click on its child", async () => {
    document.body.innerHTML = `<button id="go"><span>Go</span></button>`;
    document.querySelector("span")!.click();
    expect((await captured())[0].properties).toMatchObject({ element: "button", name: "go", text: "Go" });
  });

  it("never labels a control that shows who is signed in, but still records the click by name", async () => {
    document.body.innerHTML = `<button data-track="user-menu" data-track-no-text><span>F</span><span>Fern Quillsby</span></button>`;
    document.querySelector("button")!.click();
    expect((await captured())[0].properties).toEqual({ element: "button", route: "/dashboard", name: "user-menu" });
  });

  it("drops a label that looks like an email address", async () => {
    document.body.innerHTML = `<button>Ccody@example.test</button>`;
    document.querySelector("button")!.click();
    expect((await captured())[0].properties).toEqual({ element: "button", route: "/dashboard" });
  });

  it("drops a label inside a table, where rows hold people and their data", async () => {
    document.body.innerHTML = `<table><tbody><tr><td><button>Fern Quillsby</button></td></tr></tbody></table>`;
    document.querySelector("button")!.click();
    expect((await captured())[0].properties).toEqual({ element: "button", route: "/dashboard" });
  });

  it("keeps no labels in the admin area, but still names what it can", async () => {
    window.history.pushState({}, "", "/admin/members");
    document.body.innerHTML = `<button data-track="export-csv">Export Fern's data</button><a href="/admin/hosts">Hosts</a>`;
    document.querySelector("button")!.click();
    document.querySelector("a")!.click();
    const [button, link] = await captured();
    expect(button.properties).toEqual({ element: "button", route: "/admin/members", name: "export-csv" });
    expect(link.properties).toEqual({ element: "link", route: "/admin/members", target_route: "/admin/hosts" });
  });

  it("does not mistake a page that only starts with admin for the admin area", async () => {
    window.history.pushState({}, "", "/administrivia");
    document.body.innerHTML = `<button>Save</button>`;
    document.querySelector("button")!.click();
    expect((await captured())[0].properties).toMatchObject({ text: "Save" });
  });

  it("skips data-track-ignore and plain text", async () => {
    document.body.innerHTML = `<div data-track-ignore><button>Secret</button></div><p>hello</p>`;
    document.querySelector("button")!.click();
    document.querySelector("p")!.click();
    expect(await captured()).toEqual([]);
  });

  it("never reads text typed into a field", async () => {
    document.body.innerHTML = `<input type="text" value="my secret" />`;
    document.querySelector("input")!.click();
    expect(await captured()).toEqual([]);
  });
});
