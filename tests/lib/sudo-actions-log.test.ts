import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn();
const cookieJar = new Map<string, string>();
const getCurrentUser = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => ({
    ok: true,
    user: { id: ADMIN_ID },
    supabase: fakeSupabase(),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

function fakeSupabase() {
  return {
    from: (table: string) =>
      table === "members"
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: MEMBER_ID } }) }) }) }
        : { insert },
  };
}

import { startSudo, exitSudo } from "@/app/actions/sudo";
import { signSudoCookie } from "@/lib/sudo-cookie";

beforeEach(() => {
  process.env.SUDO_SECRET = "test-secret";
  insert.mockReset().mockResolvedValue({ error: null });
  cookieJar.clear();
  getCurrentUser.mockReset().mockResolvedValue({ id: ADMIN_ID, email: "admin@example.test" });
});

describe("sudo activity events", () => {
  it("logs a staff event about the member when sudo starts", async () => {
    await expect(startSudo(MEMBER_ID)).rejects.toThrow("REDIRECT:");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: MEMBER_ID,
        activity_type: "sudo_started",
        actor_kind: "staff",
        actor_user_id: ADMIN_ID,
        engagement_value: 0,
      })
    );
  });

  it("logs the end of the session from the signed cookie", async () => {
    cookieJar.set("sudo_as", signSudoCookie(ADMIN_ID, MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ member_id: MEMBER_ID, activity_type: "sudo_ended", actor_user_id: ADMIN_ID })
    );
    expect(cookieJar.has("sudo_as")).toBe(false);
  });

  it("logs nothing when the cookie belongs to someone else or is forged", async () => {
    cookieJar.set("sudo_as", signSudoCookie("33333333-3333-4333-8333-333333333333", MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    cookieJar.set("sudo_as", `${ADMIN_ID}:${MEMBER_ID}:deadbeef`);
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(insert).not.toHaveBeenCalled();
  });

  it("still exits when the log write fails", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    cookieJar.set("sudo_as", signSudoCookie(ADMIN_ID, MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(cookieJar.has("sudo_as")).toBe(false);
  });
});
