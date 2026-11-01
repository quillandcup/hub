import { describe, it, expect, vi, beforeEach } from "vitest";

// A stand-in for Next's data cache: memoizes by key parts + arguments, stores only returned values,
// and drops everything on revalidateTag.
const store = new Map<string, unknown>();
const revalidateTag = vi.fn((_tag: string, _profile?: unknown) => store.clear());
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile?: unknown) => revalidateTag(tag, profile),
  unstable_cache: (fn: (...a: never[]) => Promise<unknown>, keyParts: string[]) => async (...args: never[]) => {
    const key = JSON.stringify([keyParts, args]);
    if (store.has(key)) return store.get(key);
    const value = await fn(...args);
    store.set(key, value);
    return value;
  },
}));

const tables: Record<string, unknown[]> = {};
const errors: Record<string, string> = {};
const from = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    const make = (schema: string) => ({
      from: (table: string) => {
        const name = `${schema}.${table}`;
        from(name);
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = () => q;
        q.eq = () => q;
        q.is = () => q;
        q.then = (resolve: (v: unknown) => unknown) =>
          resolve(errors[name] ? { data: null, error: { message: errors[name] } } : { data: tables[name] ?? [] });
        return q;
      },
    });
    return { ...make("public"), schema: (s: string) => make(s) };
  },
}));

import { customEmojiFor, slackChannelNames, slackUserNames } from "@/lib/chat/names";
import { invalidateChatLookups } from "@/lib/chat/invalidate-lookups";
import { CHAT_LOOKUPS_TAG } from "@/lib/chat/lookup-cache";

beforeEach(() => {
  store.clear();
  from.mockClear();
  revalidateTag.mockClear();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(errors)) delete errors[k];
  tables["bronze.slack_channels"] = [{ channel_id: "C1", name: "hub-feedback" }];
  tables["bronze.slack_users"] = [{ user_id: "U1", display_name: "Fern", real_name: "Fern Example", name: "fern" }];
  tables["bronze.slack_custom_emoji"] = [{ name: "party", image_url: "https://example.com/p.png", alias_for: null }];
});

describe("cached chat lookups", () => {
  it("serves a repeat call from the cache without querying", async () => {
    expect(await slackChannelNames(["C1"])).toEqual({ C1: "hub-feedback" });
    const calls = from.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(await slackChannelNames(["C1"])).toEqual({ C1: "hub-feedback" });
    expect(from.mock.calls.length).toBe(calls);
  });

  it("treats the same ids in another order, or repeated, as one lookup", async () => {
    await slackUserNames(["U1", "U2"]);
    const calls = from.mock.calls.length;
    expect(await slackUserNames(["U2", "U1", "U1"])).toEqual({ U1: "Fern" });
    expect(from.mock.calls.length).toBe(calls);
  });

  it("does not query for an empty list", async () => {
    expect(await customEmojiFor([])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("queries again, and sees new data, after invalidation", async () => {
    await customEmojiFor(["party"]);
    tables["bronze.slack_custom_emoji"] = [{ name: "party", image_url: "https://example.com/new.png", alias_for: null }];
    expect(await customEmojiFor(["party"])).toEqual({ party: { url: "https://example.com/p.png" } });
    invalidateChatLookups();
    expect(revalidateTag).toHaveBeenCalledWith(CHAT_LOOKUPS_TAG, { expire: 0 });
    expect(await customEmojiFor(["party"])).toEqual({ party: { url: "https://example.com/new.png" } });
  });

  it("does not cache a database error, and returns an empty result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    errors["bronze.slack_channels"] = "boom";
    expect(await slackChannelNames(["C1"])).toEqual({});
    delete errors["bronze.slack_channels"];
    expect(await slackChannelNames(["C1"])).toEqual({ C1: "hub-feedback" });
    log.mockRestore();
  });
});
