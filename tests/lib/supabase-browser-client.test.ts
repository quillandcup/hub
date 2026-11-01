import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

describe("browser Supabase client", () => {
  it("is created from the public URL and anon key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
    const { createClient } = await import("@/lib/supabase/client");

    const client = createClient();

    expect(typeof client.from).toBe("function");
    expect(typeof client.auth.getSession).toBe("function");
  });
});
