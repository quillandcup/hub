import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/chat/search", () => ({
  SEARCH_PAGE_SIZE: 20,
  searchChat: vi.fn(async () => ({
    hasMore: false,
    render: { userNames: { U1: "Fern" }, userMembers: {}, channelNames: { C1: "hub-feedback" }, customEmoji: {} },
    results: [
      {
        channel: { id: "ch1", label: "#hub-feedback" },
        threadId: "m1",
        message: { id: "m1", body: "<@U1> check <#C1|channel> and <@U9>", authorName: "Moss", createdAt: "2026-10-13T12:00:00Z" },
      },
    ],
  })),
}));

import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch } from "@/lib/search/universal";

describe("universalSearch chat hits", () => {
  it("shows mentions in the title as names, not Slack ids", async () => {
    const result = await universalSearch(
      { supabase: {} as SupabaseClient, viewerMemberId: "me", isActingAsAdmin: false, chatChannels: [{ id: "ch1" } as never], limit: 10 },
      parseUniversal("in:chat check"),
      {}
    );
    const chat = result.find((r) => r.kind === "chat");
    expect(chat?.hits[0]).toMatchObject({ title: "@Fern check #hub-feedback and @someone", subtitle: "Moss in #hub-feedback" });
  });
});
