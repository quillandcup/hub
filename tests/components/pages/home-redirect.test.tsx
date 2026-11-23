import { describe, it, expect, vi, beforeEach } from "vitest";

import { APP_URL } from "@/lib/config";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: new URL(APP_URL).host }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import Home from "@/app/page";

beforeEach(() => getCurrentUser.mockReset());

describe("/ landing redirect", () => {
  it("sends signed-out visitors to login", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
  });

  it("sends every signed-in user, admins included, to the member dashboard", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    await expect(Home()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
