import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/live-room", () => ({ loadLiveRoom: vi.fn() }));

import { GET } from "@/app/api/live-room/route";
import { getCurrentUser } from "@/lib/auth";
import { loadLiveRoom } from "@/lib/live-room";

const ROOM = { live: false, count: 0, members: [], guests: 0, prickle: null, join: null };

describe("GET /api/live-room", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses anonymous callers", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(loadLiveRoom).not.toHaveBeenCalled();
  });

  it("answers 503 when the auth check fails", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error("timeout"));
    expect((await GET()).status).toBe(503);
  });

  it("returns the room, uncached, to a signed-in user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "a@example.test" });
    vi.mocked(loadLiveRoom).mockResolvedValue(ROOM);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(ROOM);
  });

  it("answers 500 when loading fails", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "a@example.test" });
    vi.mocked(loadLiveRoom).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET()).status).toBe(500);
  });
});
