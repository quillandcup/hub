import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
const state = vi.hoisted(() => ({ user: null as { id: string } | null, admin: false }));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`redirect:${to}`); }));

vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ profiles: { isAdmin: async () => state.admin } }) }));

import { startRolePreview, stopRolePreview } from "@/app/actions/staff-preview";

beforeEach(() => {
  store.set.mockClear();
  store.delete.mockClear();
  state.user = { id: "user-admin" };
  state.admin = true;
});

describe("startRolePreview", () => {
  it("sets the preview cookie for an admin and lands on the role's home", async () => {
    await expect(startRolePreview("community_manager")).rejects.toThrow("redirect:/admin/at-risk");
    expect(store.set).toHaveBeenCalledWith("staff_preview_role", "community_manager", expect.objectContaining({ httpOnly: true, path: "/" }));
  });

  it("refuses a signed-out caller and a non-admin, setting nothing", async () => {
    state.user = null;
    await expect(startRolePreview("community_manager")).rejects.toThrow("Not authorized");
    state.user = { id: "user-member" };
    state.admin = false;
    await expect(startRolePreview("community_manager")).rejects.toThrow("Not authorized");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("refuses a role that can't be previewed", async () => {
    await expect(startRolePreview("admin")).rejects.toThrow("Unknown role");
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("stopRolePreview", () => {
  it("clears the cookie and returns to the admin dashboard", async () => {
    await expect(stopRolePreview()).rejects.toThrow("redirect:/admin");
    expect(store.delete).toHaveBeenCalledWith("staff_preview_role");
  });
});
