import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));

import { analyticsUserId } from "@/lib/analytics-user";
import { getCurrentUser } from "@/lib/auth";

beforeEach(() => vi.clearAllMocks());

describe("analyticsUserId", () => {
  it("is the signed-in user's auth ID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "fern@example.com" });
    expect(await analyticsUserId("G-TEST")).toBe("u1");
  });

  it("is null for an anonymous visitor", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await analyticsUserId("G-TEST")).toBeNull();
  });

  it("is null without skipping straight past auth when GA is off", async () => {
    expect(await analyticsUserId(undefined)).toBeNull();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
});
