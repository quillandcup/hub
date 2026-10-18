// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls: string[] = [];
const signOut = vi.fn(async () => {
  calls.push("signOut");
  return { error: null };
});
const push = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import SignOutButton from "@/components/SignOutButton";

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  window.gtag = vi.fn((...args: unknown[]) => {
    calls.push(`gtag:${JSON.stringify(args)}`);
  });
});

afterEach(() => {
  delete window.gtag;
});

describe("SignOutButton", () => {
  it("clears the GA user before signing out and leaving for /login", async () => {
    render(<SignOutButton />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign Out" }));

    expect(calls).toEqual([`gtag:${JSON.stringify(["set", { user_id: null }])}`, "signOut"]);
    expect(push).toHaveBeenCalledWith("/login");
  });
});
