import { describe, expect, it, vi } from "vitest";
import { ensureCalendarWatchChannel } from "@/lib/google-calendar/watch";

interface Row {
  id: string;
  calendar_id: string;
  channel_id: string;
  resource_id: string;
  expires_at: string;
  stopped_at: string | null;
}

/** Just the query shapes watch.ts uses, over an array. */
function fakeSupabase(rows: Row[], insertError?: string) {
  return {
    rows,
    from: () => ({
      select: () => {
        let result = rows;
        const q: any = {
          eq: (col: keyof Row, v: string) => ((result = result.filter((r) => r[col] === v)), q),
          is: (col: keyof Row, v: null) => ((result = result.filter((r) => r[col] === v)), q),
          order: () => Promise.resolve({ data: [...result].sort((a, b) => b.expires_at.localeCompare(a.expires_at)), error: null }),
        };
        return q;
      },
      insert: (row: Omit<Row, "id" | "stopped_at">) => {
        if (insertError) return Promise.resolve({ error: { message: insertError } });
        rows.push({ id: `cwch_${rows.length}`, stopped_at: null, ...row });
        return Promise.resolve({ error: null });
      },
      update: (patch: Partial<Row>) => ({
        eq: (_col: string, id: string) => {
          Object.assign(rows.find((r) => r.id === id)!, patch);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  } as any;
}

const now = new Date("2026-10-28T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const existing = (id: string, days: number): Row => ({
  id,
  calendar_id: "cal@example.test",
  channel_id: `chan-${id}`,
  resource_id: `res-${id}`,
  expires_at: inDays(days),
  stopped_at: null,
});

function setup(rows: Row[], opts: { insertError?: string; stopFails?: boolean } = {}) {
  const supabase = fakeSupabase(rows, opts.insertError);
  const client = {
    watchEvents: vi.fn(async () => ({ resourceId: "res-new", expiresAt: new Date(inDays(7)) })),
    stopChannel: vi.fn(async () => {
      if (opts.stopFails) throw new Error("channel not found");
    }),
  };
  const run = () =>
    ensureCalendarWatchChannel({
      supabase,
      client,
      calendarId: "cal@example.test",
      address: "https://app.example.test/api/webhooks/calendar",
      token: "secret-token",
      now,
    });
  return { supabase, client, run };
}

describe("ensureCalendarWatchChannel", () => {
  it("opens a channel when none exists, with the token and address", async () => {
    const { supabase, client, run } = setup([]);
    const result = await run();
    expect(result).toMatchObject({ action: "created", stopped: 0 });
    expect(client.watchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "cal@example.test",
        address: "https://app.example.test/api/webhooks/calendar",
        token: "secret-token",
      })
    );
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0]).toMatchObject({ resource_id: "res-new", expires_at: inDays(7) });
  });

  it("keeps a channel with more than 3 days left", async () => {
    const { client, run } = setup([existing("a", 5)]);
    expect(await run()).toMatchObject({ action: "kept", channelId: "chan-a" });
    expect(client.watchEvents).not.toHaveBeenCalled();
  });

  it("replaces a channel with under 3 days left, opening the new one before stopping the old", async () => {
    const { supabase, client, run } = setup([existing("a", 2)]);
    expect(await run()).toMatchObject({ action: "created", stopped: 1 });
    expect(client.watchEvents.mock.invocationCallOrder[0]).toBeLessThan(client.stopChannel.mock.invocationCallOrder[0]);
    expect(client.stopChannel).toHaveBeenCalledWith("chan-a", "res-a");
    expect(supabase.rows.find((r: Row) => r.id === "a")!.stopped_at).toBe(now.toISOString());
  });

  it("replaces an already expired channel and marks it stopped even if Google no longer knows it", async () => {
    const { supabase, run } = setup([existing("a", -1)], { stopFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(run()).resolves.toMatchObject({ action: "created", stopped: 1 });
    expect(supabase.rows.find((r: Row) => r.id === "a")!.stopped_at).not.toBeNull();
    warn.mockRestore();
  });

  it("ignores channels already stopped", async () => {
    const stopped = { ...existing("a", 6), stopped_at: inDays(-1) };
    const { client, run } = setup([stopped]);
    expect(await run()).toMatchObject({ action: "created", stopped: 0 });
    expect(client.stopChannel).not.toHaveBeenCalled();
  });

  it("stops the new channel and throws when it can't be saved", async () => {
    const { client, run } = setup([], { insertError: "boom" });
    await expect(run()).rejects.toThrow("Failed to save calendar watch channel: boom");
    expect(client.stopChannel).toHaveBeenCalledWith(expect.any(String), "res-new");
  });

  it("throws when Google refuses to open the channel, leaving the old one alone", async () => {
    const { supabase, client, run } = setup([existing("a", 1)]);
    client.watchEvents.mockRejectedValueOnce(new Error("forbidden"));
    await expect(run()).rejects.toThrow("forbidden");
    expect(client.stopChannel).not.toHaveBeenCalled();
    expect(supabase.rows[0].stopped_at).toBeNull();
  });
});
