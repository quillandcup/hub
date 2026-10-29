import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../helpers/api-fetch";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn() }));
vi.mock("@/lib/event-prickles", () => ({ fetchPastEventPrickles: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { fetchPastEventPrickles } from "@/lib/event-prickles";
import { ORG_TIMEZONE } from "@/lib/config";

const url = (month?: string) => `/api/events/past-prickles${month === undefined ? "" : `?month=${month}`}`;
const PRICKLE = { id: "prkl_AAAAAAAAAAA1", title: "Pitch", typeName: "Pitch Prickle", hostName: null, calendarEventId: null, startTime: "2026-10-09T18:00:00Z", endTime: "2026-10-09T19:00:00Z" };

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
  vi.mocked(getUserFeaturePreviews).mockResolvedValue(["events"]);
  vi.mocked(getUserTimezonePreference).mockResolvedValue("America/Chicago");
  vi.mocked(fetchPastEventPrickles).mockReset().mockResolvedValue([PRICKLE]);
});

describe("GET /api/events/past-prickles", () => {
  it("returns a month's past sessions, read in the member's zone, for the browser to keep a minute", async () => {
    const res = await apiFetch(url("2026-10"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prickles: [PRICKLE] });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(fetchPastEventPrickles).toHaveBeenCalledWith(expect.anything(), { id: "2026-10", label: "October", first: "2026-10-01", last: "2026-10-31" }, "America/Chicago", expect.any(Date));
  });

  it("uses the organization's zone when the member's is not set", async () => {
    vi.mocked(getUserTimezonePreference).mockResolvedValue("browser");

    await apiFetch(url("2026-10"));

    expect(fetchPastEventPrickles).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_TIMEZONE, expect.any(Date));
  });

  it("refuses someone who is not signed in, and a member without the events feature", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await apiFetch(url("2026-10"))).status).toBe(401);

    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    vi.mocked(getUserFeaturePreviews).mockResolvedValue([]);
    expect((await apiFetch(url("2026-10"))).status).toBe(403);
    expect(fetchPastEventPrickles).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "bogus", "2026-13", "2026-00", "2026-1", "26-10"])("answers 400 for the month %j", async (month) => {
    expect((await apiFetch(url(month))).status).toBe(400);
    expect(fetchPastEventPrickles).not.toHaveBeenCalled();
  });

  it("answers 500, not a crash, when the lookup fails", async () => {
    vi.mocked(fetchPastEventPrickles).mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await apiFetch(url("2026-10"))).status).toBe(500);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
