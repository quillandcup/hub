// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { CONSENT_CHANGE_EVENT, CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";

let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import { AnalyticsEvents } from "@/components/AnalyticsEvents";
import { flush, setTrackingEnabled } from "@/lib/analytics/client";

let fetchMock: ReturnType<typeof vi.fn>;

async function sent() {
  await flush();
  return fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events as { event: string; properties: Record<string, unknown> }[]);
}

beforeEach(() => {
  mockPathname = "/dashboard";
  localStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setTrackingEnabled(false);
  vi.unstubAllGlobals();
});

describe("AnalyticsEvents", () => {
  it("reports page views where consent isn't required, with the route as a template", async () => {
    mockPathname = "/members/42";
    render(<AnalyticsEvents needsConsent={false} />);
    expect(await sent()).toEqual([{ event: "page_viewed", properties: { route: "/members/[id]" }, messageId: expect.any(String), sessionId: expect.any(String), timestamp: expect.any(String), context: expect.any(Object) }]);
  });

  it("reports again when the page changes", async () => {
    const { rerender } = render(<AnalyticsEvents needsConsent={false} />);
    mockPathname = "/my-prickles";
    rerender(<AnalyticsEvents needsConsent={false} />);
    const events = await sent();
    expect(events.map((e) => e.properties.route)).toEqual(["/dashboard", "/my-prickles"]);
  });

  it("records nothing where consent is required and hasn't been given", async () => {
    render(<AnalyticsEvents needsConsent={true} />);
    document.body.innerHTML = `<button>Go</button>`;
    document.querySelector("button")!.click();
    expect(await sent()).toEqual([]);
  });

  it("records nothing after the visitor declined", async () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
    render(<AnalyticsEvents needsConsent={true} />);
    expect(await sent()).toEqual([]);
  });

  it("starts as soon as the visitor accepts, and stops again if they change their mind", async () => {
    render(<AnalyticsEvents needsConsent={true} />);
    act(() => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    expect((await sent()).map((e) => e.event)).toEqual(["page_viewed"]);

    act(() => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    document.body.innerHTML = `<button>Go</button>`;
    document.querySelector("button")!.click();
    expect(await sent()).toHaveLength(1);
  });

  it("captures clicks while on", async () => {
    render(<AnalyticsEvents needsConsent={false} />);
    document.body.innerHTML = `<button data-track="save">Save</button>`;
    document.querySelector("button")!.click();
    const events = await sent();
    expect(events.map((e) => e.event)).toEqual(["page_viewed", "element_clicked"]);
    expect(events[1].properties).toMatchObject({ element: "button", name: "save", text: "Save" });
  });
});

describe("AnalyticsEvents: arriving through a notification", () => {
  function landOn(path: string) {
    window.history.replaceState({}, "", path);
  }

  it("records which notification brought the visit, once, and takes the tag off the address", async () => {
    landOn("/prickles/p1?tab=notes&nk=prickle_checkin&nc=slack#m-3");
    render(<AnalyticsEvents needsConsent={false} />);
    const opened = (await sent()).filter((e) => e.event === "notification_opened");
    expect(opened).toEqual([expect.objectContaining({ properties: { kind: "prickle_checkin", channel: "slack" } })]);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/prickles/p1?tab=notes#m-3");
  });

  it("leaves the address alone and records nothing when there is no tag", async () => {
    landOn("/prickles/p1?tab=notes");
    render(<AnalyticsEvents needsConsent={false} />);
    expect((await sent()).filter((e) => e.event === "notification_opened")).toEqual([]);
    expect(window.location.search).toBe("?tab=notes");
  });

  it("ignores a malformed tag, leaving it in place", async () => {
    landOn("/dashboard?nk=<script>&nc=slack");
    render(<AnalyticsEvents needsConsent={false} />);
    expect((await sent()).filter((e) => e.event === "notification_opened")).toEqual([]);
  });

  it("cleans the address but records nothing where consent is required and was not given", async () => {
    landOn("/dashboard?nk=prickle_checkin&nc=email");
    render(<AnalyticsEvents needsConsent={true} />);
    expect(await sent()).toEqual([]);
    expect(window.location.search).toBe("");
  });

  it("records it as soon as consent is given, and never if it is not", async () => {
    landOn("/dashboard?nk=prickle_checkin&nc=email");
    render(<AnalyticsEvents needsConsent={true} />);
    act(() => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    expect((await sent()).filter((e) => e.event === "notification_opened")).toEqual([
      expect.objectContaining({ properties: { kind: "prickle_checkin", channel: "email" } }),
    ]);
  });
});
