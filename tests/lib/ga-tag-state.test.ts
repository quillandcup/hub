import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GA_TAG_STATES,
  parseGaTagState,
  readGaTagState,
  watchGaTag,
  type GaTagState,
  type GaTagWindow,
} from "@/lib/analytics/ga-tag-state";

const GA_ID = "G-TEST123";

/** What src/app/layout.tsx pushes: gtag() pushes its `arguments` object. */
function command(...args: unknown[]) {
  return (function (..._a: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    return arguments;
  })(...args);
}

const granted = [command("consent", "default", { analytics_storage: "granted", ad_storage: "granted" })];
const denied = [command("consent", "default", { analytics_storage: "denied", ad_storage: "denied" })];
const running = { [GA_ID]: {} };

describe("parseGaTagState", () => {
  it.each(GA_TAG_STATES)("accepts %s", (s) => expect(parseGaTagState(s)).toBe(s));
  it.each([["tag_blocked"], [""], [true], [1], [null], [undefined], [{}], [["tag_running"]]])("drops %j", (v) =>
    expect(parseGaTagState(v)).toBeNull(),
  );
});

describe("readGaTagState", () => {
  it("is tag_running once gtag.js registered the property", () => {
    expect(readGaTagState({ dataLayer: granted, google_tag_manager: running }, GA_ID)).toBe("tag_running");
  });

  it("is not_loaded when analytics is allowed and the tag has not run (blocked)", () => {
    expect(readGaTagState({ dataLayer: granted }, GA_ID)).toBe("not_loaded");
    expect(readGaTagState({ dataLayer: granted, google_tag_manager: { "G-OTHER": {} } }, GA_ID)).toBe("not_loaded");
  });

  it("is not_applicable without a GA id", () => {
    expect(readGaTagState({ dataLayer: granted }, undefined)).toBe("not_applicable");
    expect(readGaTagState({ dataLayer: granted, google_tag_manager: running }, "")).toBe("not_applicable");
  });

  it("is not_applicable while consent is denied, even if the tag loaded", () => {
    expect(readGaTagState({ dataLayer: denied, google_tag_manager: running }, GA_ID)).toBe("not_applicable");
    expect(readGaTagState({ dataLayer: denied }, GA_ID)).toBe("not_applicable");
  });

  it("follows the last consent command: a banner accept after a denied default, and an opt-out after a granted one", () => {
    const accepted = [...denied, command("consent", "update", { analytics_storage: "granted" })];
    expect(readGaTagState({ dataLayer: accepted }, GA_ID)).toBe("not_loaded");
    const optedOut = [...granted, command("consent", "update", { analytics_storage: "denied", ad_storage: "denied" })];
    expect(readGaTagState({ dataLayer: optedOut, google_tag_manager: running }, GA_ID)).toBe("not_applicable");
  });

  it("ignores data layer entries that are not consent commands, and plain arrays too", () => {
    const layer = [null, "x", { event: "gtm.js" }, command("config", GA_ID), ["consent", "update", { analytics_storage: "denied" }]];
    expect(readGaTagState({ dataLayer: layer }, GA_ID)).toBe("not_applicable");
    expect(readGaTagState({ dataLayer: [command("consent", "default", {})] }, GA_ID)).toBe("not_loaded");
    expect(readGaTagState({}, GA_ID)).toBe("not_loaded");
  });
});

describe("watchGaTag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function watch(win: GaTagWindow & { document?: { readyState: DocumentReadyState } }) {
    const onSettled = vi.fn<(s: GaTagState) => void>();
    const handle = watchGaTag(win, GA_ID, onSettled);
    return { onSettled, handle };
  }

  it("reports at once when the tag is already running", () => {
    const { onSettled } = watch({ dataLayer: granted, google_tag_manager: running });
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("tag_running");
  });

  it("reports at once when analytics is denied (no waiting for a tag that sets no cookie)", () => {
    const { onSettled } = watch({ dataLayer: denied });
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("not_applicable");
  });

  it("slow load: a tag that starts running during the wait is tag_running, not not_loaded", () => {
    const win: GaTagWindow & { document: { readyState: DocumentReadyState } } = { dataLayer: granted, document: { readyState: "loading" } };
    const { onSettled } = watch(win);
    vi.advanceTimersByTime(1500);
    expect(onSettled).not.toHaveBeenCalled();
    win.document.readyState = "complete";
    vi.advanceTimersByTime(1000);
    win.google_tag_manager = running;
    vi.advanceTimersByTime(250);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("tag_running");
    vi.advanceTimersByTime(20_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("blocked: reports not_loaded only after the grace past the load event", () => {
    const win = { dataLayer: granted, document: { readyState: "complete" as DocumentReadyState } };
    const { onSettled } = watch(win);
    vi.advanceTimersByTime(1500);
    expect(onSettled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("not_loaded");
  });

  it("a page that never finishes loading is reported not_loaded at the cap", () => {
    const { onSettled } = watch({ dataLayer: granted, document: { readyState: "loading" } });
    vi.advanceTimersByTime(7500);
    expect(onSettled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("not_loaded");
  });

  it("settleNow reports the current state once (leaving the page) and stops the wait", () => {
    const { onSettled, handle } = watch({ dataLayer: granted, document: { readyState: "complete" } });
    handle.settleNow();
    handle.settleNow();
    vi.advanceTimersByTime(20_000);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("not_loaded");
  });

  it("without a document it still ends at the cap", () => {
    const { onSettled } = watch({ dataLayer: granted });
    vi.advanceTimersByTime(8250);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("not_loaded");
  });
});
