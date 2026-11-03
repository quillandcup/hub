// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import LivePoll from "@/components/LivePoll";

describe("LivePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("refreshes the page on every interval while the tab shows", () => {
    render(<LivePoll everyMs={30_000} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips the refresh while the tab is hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<LivePoll everyMs={30_000} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it("stops when unmounted", () => {
    const { unmount } = render(<LivePoll everyMs={30_000} />);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
