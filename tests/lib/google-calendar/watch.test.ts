import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryCalendarSyncStateRepository } from "@/lib/data/calendar-sync-state";
import { ensureCalendarWatchChannel } from "@/lib/google-calendar/watch";

// The channels live in an in-memory dataset instead of a database.
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...original, createRepos: () => original.createInMemoryRepos(dataset) };
});

type Row = InMemoryDataset["calendarWatchChannels"][number];

const now = new Date("2026-10-28T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const existing = (id: string, days: number): Row => ({
  id,
  calendar_id: "cal@example.test",
  channel_id: `chan-${id}`,
  resource_id: `res-${id}`,
  expires_at: inDays(days),
  stopped_at: null,
  created_at: inDays(-1),
});

beforeEach(() => {
  dataset = new InMemoryDataset();
  vi.restoreAllMocks();
});

function setup(rows: Row[], opts: { stopFails?: boolean } = {}) {
  dataset.calendarWatchChannels.push(...rows);
  const client = {
    watchEvents: vi.fn(async () => ({ resourceId: "res-new", expiresAt: new Date(inDays(7)) })),
    stopChannel: vi.fn(async () => {
      if (opts.stopFails) throw new Error("channel not found");
    }),
  };
  const run = () =>
    ensureCalendarWatchChannel({
      supabase: {} as never,
      client,
      calendarId: "cal@example.test",
      address: "https://app.example.test/api/webhooks/calendar",
      token: "secret-token",
      now,
    });
  return { rows: dataset.calendarWatchChannels, client, run };
}

describe("ensureCalendarWatchChannel", () => {
  it("opens a channel when none exists, with the token and address", async () => {
    const { rows, client, run } = setup([]);
    const result = await run();
    expect(result).toMatchObject({ action: "created", stopped: 0 });
    expect(client.watchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "cal@example.test",
        address: "https://app.example.test/api/webhooks/calendar",
        token: "secret-token",
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resource_id: "res-new", expires_at: inDays(7) });
  });

  it("keeps a channel with more than 3 days left", async () => {
    const { client, run } = setup([existing("a", 5)]);
    expect(await run()).toMatchObject({ action: "kept", channelId: "chan-a" });
    expect(client.watchEvents).not.toHaveBeenCalled();
  });

  it("replaces a channel with under 3 days left, opening the new one before stopping the old", async () => {
    const { rows, client, run } = setup([existing("a", 2)]);
    expect(await run()).toMatchObject({ action: "created", stopped: 1 });
    expect(client.watchEvents.mock.invocationCallOrder[0]).toBeLessThan(client.stopChannel.mock.invocationCallOrder[0]);
    expect(client.stopChannel).toHaveBeenCalledWith("chan-a", "res-a");
    expect(rows.find((r) => r.id === "a")!.stopped_at).toBe(now.toISOString());
  });

  it("replaces an already expired channel and marks it stopped even if Google no longer knows it", async () => {
    const { rows, run } = setup([existing("a", -1)], { stopFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(run()).resolves.toMatchObject({ action: "created", stopped: 1 });
    expect(rows.find((r) => r.id === "a")!.stopped_at).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not stop channel chan-a"), expect.any(Error));
  });

  it("ignores channels already stopped", async () => {
    const stopped = { ...existing("a", 6), stopped_at: inDays(-1) };
    const { client, run } = setup([stopped]);
    expect(await run()).toMatchObject({ action: "created", stopped: 0 });
    expect(client.stopChannel).not.toHaveBeenCalled();
  });

  it("stops the new channel and throws when it can't be saved", async () => {
    const { client, run } = setup([]);
    vi.spyOn(InMemoryCalendarSyncStateRepository.prototype, "saveWatchChannel").mockRejectedValueOnce(new Error("boom"));
    await expect(run()).rejects.toThrow("Failed to save calendar watch channel: boom");
    expect(client.stopChannel).toHaveBeenCalledWith(expect.any(String), "res-new");
  });

  it("throws when the channels can't be read", async () => {
    const { client, run } = setup([]);
    vi.spyOn(InMemoryCalendarSyncStateRepository.prototype, "activeWatchChannels").mockRejectedValueOnce(new Error("down"));
    await expect(run()).rejects.toThrow("Failed to read calendar watch channels: down");
    expect(client.watchEvents).not.toHaveBeenCalled();
  });

  it("still counts an old channel as stopped when recording that fails, and says so", async () => {
    const { client, run } = setup([existing("a", 1)]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(InMemoryCalendarSyncStateRepository.prototype, "markWatchChannelStopped").mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toMatchObject({ action: "created", stopped: 1 });
    expect(client.stopChannel).toHaveBeenCalledWith("chan-a", "res-a");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not mark channel chan-a stopped"), expect.any(Error));
  });

  it("throws when Google refuses to open the channel, leaving the old one alone", async () => {
    const { rows, client, run } = setup([existing("a", 1)]);
    client.watchEvents.mockRejectedValueOnce(new Error("forbidden"));
    await expect(run()).rejects.toThrow("forbidden");
    expect(client.stopChannel).not.toHaveBeenCalled();
    expect(rows[0].stopped_at).toBeNull();
  });
});
