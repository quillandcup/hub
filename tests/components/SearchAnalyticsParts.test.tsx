// @vitest-environment jsdom
/** The small pieces server-rendered search pages use to report: a result link, a "search ran" reporter, and the hold-until-consent helper behind it. They run against the real client queue; what gets sent is read from the request. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { flush, setTrackingEnabled, trackWhenEnabled } from "@/lib/analytics/client";
import SearchHitLink from "@/components/search/SearchHitLink";
import SearchRan from "@/components/search/SearchRan";

let fetchMock: ReturnType<typeof vi.fn>;

async function sent() {
  await flush();
  return fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events as { event: string; properties: Record<string, unknown> }[]);
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});

afterEach(() => {
  setTrackingEnabled(false);
  vi.unstubAllGlobals();
});

describe("SearchHitLink", () => {
  it("records opening the result, then follows the link", async () => {
    setTrackingEnabled(true);
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <SearchHitLink href="/members/m1" surface="page" kind="members" rank={4} onClick={onClick}>
        Fern
      </SearchHitLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Fern" }));
    expect(await sent()).toEqual([
      expect.objectContaining({ event: "search_result_clicked", properties: { surface: "page", kind: "members", rank: 4, via: "click" } }),
    ]);
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Fern" })).toHaveAttribute("href", "/members/m1");
  });

  it("records nothing while tracking is off", async () => {
    render(
      <SearchHitLink href="/members/m1" surface="page" kind="members" rank={1} onClick={(e) => e.preventDefault()}>
        Fern
      </SearchHitLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Fern" }));
    expect(await sent()).toEqual([]);
  });
});

describe("trackWhenEnabled", () => {
  it("sends at once when tracking is on", async () => {
    setTrackingEnabled(true);
    trackWhenEnabled("search_opened", { via: "button" });
    expect((await sent()).map((e) => e.event)).toEqual(["search_opened"]);
  });

  it("waits for tracking to be switched on, and sends then, once", async () => {
    trackWhenEnabled("search_opened", { via: "button" });
    expect(await sent()).toEqual([]);
    setTrackingEnabled(true);
    expect((await sent()).map((e) => e.event)).toEqual(["search_opened"]);
    setTrackingEnabled(false);
    setTrackingEnabled(true);
    fetchMock.mockClear();
    expect(await sent()).toEqual([]);
  });

  it("never sends for a visitor who has not agreed, even if tracking is switched off and on again", async () => {
    trackWhenEnabled("search_opened", { via: "button" });
    setTrackingEnabled(false);
    setTrackingEnabled(true);
    expect(await sent()).toEqual([]);
  });

  it("can be cancelled, as when the page unmounts first", async () => {
    const cancel = trackWhenEnabled("search_opened", { via: "button" });
    cancel();
    setTrackingEnabled(true);
    expect(await sent()).toEqual([]);
  });
});

describe("SearchRan", () => {
  const props = { surface: "page" as const, kind: "chat", operators: "in", words: 1, results: 3, chatResults: 3, chatSearched: true };

  it("reports the search once tracking is on, with the counts", async () => {
    const { unmount } = render(<SearchRan {...props} />);
    expect(await sent()).toEqual([]);
    setTrackingEnabled(true);
    expect(await sent()).toEqual([
      expect.objectContaining({
        event: "search_ran",
        properties: { surface: "page", kind: "chat", operators: "in", words: 1, results: 3, chat_results: 3, chat_searched: true },
      }),
    ]);
    unmount();
  });

  it("reports at once when tracking is already on", async () => {
    setTrackingEnabled(true);
    render(<SearchRan {...props} />);
    expect((await sent()).map((e) => e.event)).toEqual(["search_ran"]);
  });

  it("sends nothing if the page goes away before tracking is on", async () => {
    render(<SearchRan {...props} />).unmount();
    setTrackingEnabled(true);
    expect(await sent()).toEqual([]);
  });
});
