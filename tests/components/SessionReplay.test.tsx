// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { CONSENT_CHANGE_EVENT, CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";

const replay = { start: vi.fn(), stop: vi.fn(), startBuffering: vi.fn() };
let hasReplay = true;
vi.mock("@sentry/nextjs", () => ({ getReplay: () => (hasReplay ? replay : undefined) }));

import { SessionReplay, REPLAY_SESSION_SAMPLE_RATE } from "@/components/SessionReplay";

/** Make this page load fall inside (true) or outside (false) the recorded sample. */
function sample(inSample: boolean) {
  vi.spyOn(Math, "random").mockReturnValue(inSample ? REPLAY_SESSION_SAMPLE_RATE - 0.01 : REPLAY_SESSION_SAMPLE_RATE + 0.01);
}

beforeEach(() => {
  hasReplay = true;
  localStorage.clear();
  replay.start.mockReset();
  replay.stop.mockReset().mockResolvedValue(undefined);
  replay.startBuffering.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("SessionReplay", () => {
  it("records a visit in full when statistics are allowed and the visit is in the sample", () => {
    sample(true);
    render(<SessionReplay needsConsent={false} />);
    expect(replay.start).toHaveBeenCalledTimes(1);
  });

  it("leaves the visit to error-only recording when it is outside the sample", () => {
    sample(false);
    render(<SessionReplay needsConsent={false} />);
    expect(replay.start).not.toHaveBeenCalled();
  });

  it("never records a visit in full for someone who left usage statistics, but leaves error recording alone", () => {
    sample(true);
    render(<SessionReplay needsConsent={false} optedOut />);
    expect(replay.start).not.toHaveBeenCalled();
    expect(replay.stop).not.toHaveBeenCalled();
  });

  it("waits for consent where it is required, and starts when it is granted", () => {
    sample(true);
    render(<SessionReplay needsConsent />);
    expect(replay.start).not.toHaveBeenCalled();
    act(() => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    expect(replay.start).toHaveBeenCalledTimes(1);
  });

  it("falls back to error-only recording when consent is withdrawn mid-visit, and does not restart", async () => {
    sample(true);
    localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<SessionReplay needsConsent />);
    expect(replay.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    expect(replay.stop).toHaveBeenCalledTimes(1);
    expect(replay.startBuffering).toHaveBeenCalledTimes(1);
    await act(async () => {
      localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    });
    expect(replay.start).toHaveBeenCalledTimes(2);
  });

  it("does nothing when Sentry has no replay (unset DSN, local development)", () => {
    hasReplay = false;
    sample(true);
    render(<SessionReplay needsConsent={false} />);
    expect(replay.start).not.toHaveBeenCalled();
  });
});
