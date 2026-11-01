import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

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
    supabase: {},
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

// The member being sudo'd into and the activity log are in memory.
let dataset = new InMemoryDataset();
let failRecord = false;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: () => {
      const repos = actual.createInMemoryRepos(dataset);
      if (failRecord) repos.activities.record = async () => Promise.reject(new Error("boom"));
      return repos;
    },
  };
});

import { startSudo, exitSudo, exitSudoToAdmin } from "@/app/actions/sudo";
import { signSudoCookie } from "@/lib/sudo-cookie";

beforeEach(() => {
  process.env.SUDO_SECRET = "test-secret";
  dataset = new InMemoryDataset({ members: [{ id: MEMBER_ID, name: "Fern Example", email: "fern@example.test" }] });
  failRecord = false;
  cookieJar.clear();
  getCurrentUser.mockReset().mockResolvedValue({ id: ADMIN_ID, email: "admin@example.test" });
});

describe("sudo activity events", () => {
  it("logs a staff event about the member when sudo starts", async () => {
    await expect(startSudo(MEMBER_ID)).rejects.toThrow("REDIRECT:");
    expect(dataset.activities).toEqual([
      expect.objectContaining({
        member_id: MEMBER_ID,
        activity_type: "sudo_started",
        actor_kind: "staff",
        actor_user_id: ADMIN_ID,
        engagement_value: 0,
        source: "sudo",
      }),
    ]);
  });

  it("logs the end of the session from the signed cookie", async () => {
    cookieJar.set("sudo_as", signSudoCookie(ADMIN_ID, MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(dataset.activities).toEqual([expect.objectContaining({ member_id: MEMBER_ID, activity_type: "sudo_ended", actor_user_id: ADMIN_ID })]);
    expect(cookieJar.has("sudo_as")).toBe(false);
  });

  it("logs nothing when the cookie belongs to someone else or is forged", async () => {
    cookieJar.set("sudo_as", signSudoCookie("33333333-3333-4333-8333-333333333333", MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    cookieJar.set("sudo_as", `${ADMIN_ID}:${MEMBER_ID}:deadbeef`);
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(dataset.activities).toEqual([]);
  });

  it("still exits when the log write fails", async () => {
    failRecord = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    cookieJar.set("sudo_as", signSudoCookie(ADMIN_ID, MEMBER_ID));
    await expect(exitSudo()).rejects.toThrow("REDIRECT:");
    expect(cookieJar.has("sudo_as")).toBe(false);
  });

  it("ends sudo and opens the admin portal from the sidebar link", async () => {
    cookieJar.set("sudo_as", signSudoCookie(ADMIN_ID, MEMBER_ID));
    cookieJar.set("sudo_return_to", "/dashboard");
    await expect(exitSudoToAdmin()).rejects.toThrow("REDIRECT:/admin");
    expect(cookieJar.has("sudo_as")).toBe(false);
    expect(cookieJar.has("sudo_return_to")).toBe(false);
    expect(dataset.activities).toEqual([expect.objectContaining({ activity_type: "sudo_ended" })]);
  });
});
