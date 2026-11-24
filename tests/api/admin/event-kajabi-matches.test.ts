import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/api-auth", () => ({ requireApiPermission: vi.fn() }));
vi.mock("@/lib/data/repos", () => ({ createRepos: vi.fn() }));
vi.mock("@/lib/kajabi-event-matching", () => ({ findKajabiMatchesForEvent: vi.fn() }));
vi.mock("@/lib/kajabi/client", () => ({
  createKajabiClient: vi.fn(() => ({ fetchContactWithAttachments: vi.fn() })),
  contactOfferIds: vi.fn(() => []),
}));

import { GET } from "@/app/api/admin/events/[id]/kajabi-matches/route";
import { requireApiPermission } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { findKajabiMatchesForEvent } from "@/lib/kajabi-event-matching";
import { createKajabiClient } from "@/lib/kajabi/client";

const params = { params: Promise.resolve({ id: "evt_AAAAAAAAAAA1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireApiPermission).mockResolvedValue({ user: { id: "u" }, forbidden: false, supabase: {} } as never);
  vi.mocked(createRepos).mockReturnValue({ events: { byId: vi.fn().mockResolvedValue({ id: "evt_AAAAAAAAAAA1" }) } } as never);
  vi.mocked(findKajabiMatchesForEvent).mockResolvedValue({ offersLinked: true } as never);
});

describe("GET /api/admin/events/[id]/kajabi-matches", () => {
  it("makes no Kajabi call and skips grants by default (page load)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/events/x/kajabi-matches"), params);

    expect(res.status).toBe(200);
    expect(createKajabiClient).not.toHaveBeenCalled();
    expect(findKajabiMatchesForEvent).toHaveBeenCalledWith(expect.anything(), "evt_AAAAAAAAAAA1", undefined, { skipGrants: true });
  });

  it("passes the live lookup only with ?grants=1", async () => {
    await GET(new NextRequest("http://localhost/api/admin/events/x/kajabi-matches?grants=1"), params);

    expect(createKajabiClient).toHaveBeenCalled();
    expect(findKajabiMatchesForEvent).toHaveBeenCalledWith(expect.anything(), "evt_AAAAAAAAAAA1", expect.any(Function), { skipGrants: false });
  });

  it("refuses without the permission", async () => {
    vi.mocked(requireApiPermission).mockResolvedValue({ user: { id: "u" }, forbidden: true } as never);
    const res = await GET(new NextRequest("http://localhost/api/admin/events/x/kajabi-matches"), params);
    expect(res.status).toBe(403);
  });
});
