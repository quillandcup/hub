import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getCurrentUser = vi.hoisted(() => vi.fn());
const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { POST } from "@/app/api/client-errors/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/client-errors", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ id: "u1", email: "a@example.com" });
  sendOperationsAlert.mockClear();
});

describe("POST /api/client-errors", () => {
  it("alerts with the route as a template, never the ids in the path", async () => {
    const response = await post({ path: "/admin/events/evt_esQojgSTH2XD?x=1", message: "Error: boom" });
    expect(response.status).toBe(204);
    expect(sendOperationsAlert).toHaveBeenCalledWith({}, { type: "client_crash", route: "/admin/events/[id]", message: "Error: boom" });
  });

  it("refuses anyone not signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await post({ path: "/x", message: "m" })).status).toBe(401);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("rejects a malformed body, a non-path and a missing message", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ path: "https://evil.example/x", message: "m" })).status).toBe(400);
    expect((await post({ path: "/x" })).status).toBe(400);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });
});
