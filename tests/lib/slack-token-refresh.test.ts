import { describe, it, expect, vi } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { withRefreshLease } from "@/lib/slack-token-refresh";

function service(claim: boolean | Error, release: "ok" | "fails" = "ok") {
  const rpc = vi.fn(async (name: string) => {
    if (name === "slack_token_refresh_claim") return claim instanceof Error ? { data: null, error: claim } : { data: claim, error: null };
    if (release === "fails") return Promise.reject(new Error("db down"));
    return { data: null, error: null };
  });
  return { rpc } as never as import("@supabase/supabase-js").SupabaseClient & { rpc: typeof rpc };
}

describe("withRefreshLease", () => {
  const fake = useFakeClock();

  it("refreshes when it wins the lease, and gives the lease back", async () => {
    const s = service(true);
    const refresh = vi.fn(async () => "new");
    await expect(withRefreshLease(s, "bot", { fallback: "old", reread: async () => null, refresh })).resolves.toBe("new");
    expect(s.rpc).toHaveBeenCalledWith("slack_token_refresh_claim", { p_key: "bot", p_seconds: 60 });
    expect(s.rpc).toHaveBeenLastCalledWith("slack_token_refresh_release", { p_key: "bot" });
  });

  it("gives the lease back when the refresh fails, and passes the failure on", async () => {
    const s = service(true);
    await expect(withRefreshLease(s, "bot", { fallback: null, reread: async () => null, refresh: async () => Promise.reject(new Error("slack said no")) })).rejects.toThrow("slack said no");
    expect(s.rpc).toHaveBeenLastCalledWith("slack_token_refresh_release", { p_key: "bot" });
  });

  it("doesn't let a failure to release the lease hide the result", async () => {
    await expect(withRefreshLease(service(true, "fails"), "bot", { fallback: null, reread: async () => null, refresh: async () => "new" })).resolves.toBe("new");
  });

  it("uses the fallback at once, without refreshing or waiting, when someone else holds the lease", async () => {
    const refresh = vi.fn(async () => "new");
    const reread = vi.fn(async () => "other");
    await expect(withRefreshLease(service(false), "bot", { fallback: "old", reread, refresh })).resolves.toBe("old");
    expect(refresh).not.toHaveBeenCalled();
    expect(reread).not.toHaveBeenCalled();
  });

  it("with nothing usable, waits for the holder's result and uses it", async () => {
    const start = fake.clock.now();
    const answers = [null, null, "from-holder"];
    const reread = vi.fn(async () => answers.shift() ?? null);
    await expect(withRefreshLease(service(false), "bot", { fallback: null, reread, refresh: async () => "no" })).resolves.toBe("from-holder");
    expect(reread).toHaveBeenCalledTimes(3);
    expect(fake.clock.now() - start).toBe(3 * 400);
  });

  it("gives up with null after about ten seconds of waiting", async () => {
    const start = fake.clock.now();
    await expect(withRefreshLease(service(false), "bot", { fallback: null, reread: async () => null, refresh: async () => "no" })).resolves.toBeNull();
    expect(fake.clock.now() - start).toBe(25 * 400);
  });

  it("throws when the lease can't be claimed at all (the database), so the caller can decide", async () => {
    await expect(withRefreshLease(service(new Error("db down")), "bot", { fallback: "old", reread: async () => null, refresh: async () => "new" })).rejects.toThrow("db down");
  });
});
