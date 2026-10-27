import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, DELETE } from "@/app/api/zoom/ignore/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/processing/trigger", () => ({
  triggerReprocessing: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";

const PRICKLE_ID = "prkl_AAAAAAAAAAA1";

function makeRequest(method: "POST" | "DELETE", body: unknown) {
  return new NextRequest("http://localhost/api/zoom/ignore", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeSupabaseMock(error: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const insert = vi.fn().mockResolvedValue({ error });
  const eq2 = vi.fn().mockResolvedValue({ error });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const eqOnly = vi.fn().mockResolvedValue({ error });
  const del = vi.fn(() => ({ eq: eq1 }));
  const delGlobal = vi.fn(() => ({ eq: eqOnly }));
  const from = vi.fn((table: string) => {
    if (table === "ignored_zoom_appearances") return { upsert, delete: del };
    if (table === "ignored_zoom_names") return { insert, delete: delGlobal };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from, upsert, insert, del, eq1, eq2, delGlobal, eqOnly };
}

function signInAsAdmin(supabase: ReturnType<typeof makeSupabaseMock>) {
  vi.mocked(requireAdmin).mockResolvedValue({
    user: { id: "admin-1" } as any,
    forbidden: false,
    supabase: supabase as any,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/zoom/ignore", () => {
  it("returns 401 when unauthenticated and 403 for a non-admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as any });
    expect((await POST(makeRequest("POST", { zoomName: "iPhone" }))).status).toBe(401);

    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "u1" } as any, forbidden: true, supabase: {} as any });
    expect((await POST(makeRequest("POST", { zoomName: "iPhone" }))).status).toBe(403);
  });

  it("rejects a malformed body and a missing name", async () => {
    signInAsAdmin(makeSupabaseMock());
    expect((await POST(makeRequest("POST", "{nope"))).status).toBe(400);
    expect((await POST(makeRequest("POST", {}))).status).toBe(400);
  });

  it("without a prickle, ignores the name everywhere and reprocesses", async () => {
    const mock = makeSupabaseMock();
    signInAsAdmin(mock);

    const response = await POST(makeRequest("POST", { zoomName: "iPhone", reason: "a phone" }));

    expect(response.status).toBe(200);
    expect(mock.insert).toHaveBeenCalledWith({ zoom_name: "iPhone", reason: "a phone", ignored_by: "admin-1" });
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(triggerReprocessing).toHaveBeenCalledWith("ignored_zoom_names", "local");
  });

  it("with a prickle, ignores only that prickle's appearance and leaves the global list alone", async () => {
    const mock = makeSupabaseMock();
    signInAsAdmin(mock);

    const response = await POST(makeRequest("POST", { zoomName: "iPhone", prickleId: PRICKLE_ID }));

    expect(response.status).toBe(200);
    expect(mock.upsert).toHaveBeenCalledWith(
      { prickle_id: PRICKLE_ID, zoom_name: "iPhone", ignored_by: "admin-1" },
      { onConflict: "prickle_id,zoom_name", ignoreDuplicates: true }
    );
    expect(mock.insert).not.toHaveBeenCalled();
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });

  it("rejects a prickle id that isn't one of ours", async () => {
    const mock = makeSupabaseMock();
    signInAsAdmin(mock);

    const response = await POST(makeRequest("POST", { zoomName: "iPhone", prickleId: "not-an-id" }));

    expect(response.status).toBe(400);
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("reports a database error for either scope", async () => {
    const mock = makeSupabaseMock({ message: "boom" });
    signInAsAdmin(mock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await POST(makeRequest("POST", { zoomName: "iPhone", prickleId: PRICKLE_ID }))).status).toBe(500);
    expect((await POST(makeRequest("POST", { zoomName: "iPhone" }))).status).toBe(500);
  });
});

describe("DELETE /api/zoom/ignore", () => {
  it("rejects a malformed body and a missing name", async () => {
    signInAsAdmin(makeSupabaseMock());
    expect((await DELETE(makeRequest("DELETE", "{nope"))).status).toBe(400);
    expect((await DELETE(makeRequest("DELETE", {}))).status).toBe(400);
  });

  it("without a prickle, un-ignores the name everywhere and reprocesses", async () => {
    const mock = makeSupabaseMock();
    signInAsAdmin(mock);

    const response = await DELETE(makeRequest("DELETE", { zoomName: "iPhone" }));

    expect(response.status).toBe(200);
    expect(mock.eqOnly).toHaveBeenCalledWith("zoom_name", "iPhone");
    expect(triggerReprocessing).toHaveBeenCalledWith("ignored_zoom_names", "local");
  });

  it("with a prickle, removes only that prickle's ignore", async () => {
    const mock = makeSupabaseMock();
    signInAsAdmin(mock);

    const response = await DELETE(makeRequest("DELETE", { zoomName: "iPhone", prickleId: PRICKLE_ID }));

    expect(response.status).toBe(200);
    expect(mock.eq1).toHaveBeenCalledWith("prickle_id", PRICKLE_ID);
    expect(mock.eq2).toHaveBeenCalledWith("zoom_name", "iPhone");
    expect(mock.delGlobal).not.toHaveBeenCalled();
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });

  it("rejects a bad prickle id and reports a database error", async () => {
    const mock = makeSupabaseMock({ message: "boom" });
    signInAsAdmin(mock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await DELETE(makeRequest("DELETE", { zoomName: "iPhone", prickleId: "x" }))).status).toBe(400);
    expect((await DELETE(makeRequest("DELETE", { zoomName: "iPhone", prickleId: PRICKLE_ID }))).status).toBe(500);
  });
});
