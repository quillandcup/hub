import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sweep = vi.fn();
vi.mock("@/lib/chat/file-cleanup", () => ({ sweepDeletedFileBytes: (...a: unknown[]) => sweep(...a) }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "u" }, forbidden: false }) }));
vi.mock("@/lib/slack-matching", () => ({ loadVerifiedSlackLinks: async () => [], matchSlackUsersToMembers: async () => [] }));
vi.mock("@/lib/chat/slack-post", () => ({ retryUnsentChatMessages: async () => ({ sent: 0, failed: 0, expired: 0 }) }));
vi.mock("@/lib/chat/staging", () => ({ purgeStagedChatFiles: async () => 0 }));

const empty = () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return chain;
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: empty,
    schema: () => ({ from: empty }),
    rpc: async () => ({ data: { channels: 0, members: 0, messages: 0, reactions: 0 }, error: null }),
  }),
}));

import { POST } from "@/app/api/process/chat/route";

const call = () =>
  POST(new NextRequest("http://x/api/process/chat", { method: "POST", body: JSON.stringify({ fromDate: "2026-01-01", toDate: "2026-01-01" }) }));

beforeEach(() => {
  sweep.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/process/chat deleted-file sweep", () => {
  it("reports what the sweep removed", async () => {
    sweep.mockResolvedValue({ removed: 3, failed: 1 });
    const body = await (await call()).json();
    expect(body.processed.sweptFiles).toEqual({ removed: 3, failed: 1 });
  });

  it("survives a sweep that throws", async () => {
    sweep.mockRejectedValue(new Error("boom"));
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).processed.sweptFiles).toEqual({ removed: 0, failed: 1 });
  });
});
