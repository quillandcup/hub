import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyOtp, redirect, takeNextPath } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  takeNextPath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
vi.mock("@/lib/next-path-cookie", () => ({ takeNextPath }));

import { verifyEmailCode } from "@/app/login/actions";

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  redirect.mockClear();
  takeNextPath.mockReset().mockResolvedValue("/courses");
});

describe("verifyEmailCode", () => {
  it.each(["", "abc", "12345", "123456789"])("rejects %j without calling Supabase", async (code) => {
    const result = await verifyEmailCode("member@example.com", code);

    expect(result.error).toMatch(/digits only/);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies the code (spaces removed, email lowercased) and goes to the remembered page", async () => {
    await expect(verifyEmailCode(" Member@Example.com ", "1234 5678")).rejects.toThrow("NEXT_REDIRECT");

    expect(verifyOtp).toHaveBeenCalledWith({ email: "member@example.com", token: "12345678", type: "email" });
    expect(redirect).toHaveBeenCalledWith("/courses");
  });

  it("returns a plain message, not Supabase's, when the code is refused", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });

    const result = await verifyEmailCode("member@example.com", "12345678");

    expect(result.error).toMatch(/didn't work/);
    expect(result.error).not.toMatch(/Token has expired/);
    expect(redirect).not.toHaveBeenCalled();
  });
});
