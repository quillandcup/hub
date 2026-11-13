import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { InMemoryDataset } from "@/lib/data/in-memory";

/**
 * The Slack webhook with the app installed in two workspaces: an event is filed under the workspace its team_id names (even when
 * both workspaces use the same channel id), and one from a workspace the Hub doesn't know is refused.
 */
const { afterWork } = vi.hoisted(() => ({ afterWork: [] as Promise<unknown>[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void | Promise<void>) => void afterWork.push(Promise.resolve().then(callback)) };
});
vi.mock("@/lib/slack-activity-projection", () => ({ projectSlackActivity: vi.fn(async () => ({ messages: 0, reactions: 0 })) }));
vi.mock("@/lib/chat-projection", () => ({ projectChatMessage: vi.fn(async () => false) }));
vi.mock("@/lib/chat/gap-fill", () => ({ fillMessageGap: vi.fn(), fillThreadIfRootMissing: vi.fn() }));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessageBySlackTs: vi.fn() }));
vi.mock("@/lib/chat/slack-dm-events", () => ({ decideDmEvent: vi.fn(async () => ({ kind: "keep" })), isMemberTokenConversation: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({ ...(await importOriginal<typeof import("@supabase/supabase-js")>()), createClient: () => ({}) }));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: (_db: unknown, options?: { slackWorkspaceId?: string }) => actual.createInMemoryRepos(dataset, options) };
});

import { POST } from "@/app/api/webhooks/slack/route";

const SECRET = "test-slack-secret";
const PRIMARY_TEAM = "T_WEBHOOK_PRIMARY";
const SECOND_TEAM = "T_WEBHOOK_SECOND";
const SAME_CHANNEL = "C_SHARED_ID";
// Recent, so the deletion is not "beyond Slack's history".
const BASE = Math.floor(Date.now() / 1000) - 3600;
const T1 = `${BASE}.000100`;
const T2 = `${BASE}.000200`;
const T3 = `${BASE + 1}.000100`;

async function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = "v0=" + createHmac("sha256", SECRET).update(`v0:${timestamp}:${body}`).digest("hex");
  const response = await POST(
    new Request("http://localhost:3000/api/webhooks/slack", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-slack-signature": signature, "x-slack-request-timestamp": timestamp }),
      body,
    }) as unknown as NextRequest
  );
  await Promise.all(afterWork.splice(0));
  return response;
}

const message = (team: string, ts: string, text: string) => ({
  type: "event_callback",
  team_id: team,
  event: { type: "message", channel: SAME_CHANNEL, user: "U_SAME", ts, text, event_ts: ts },
});

beforeEach(() => {
  vi.stubEnv("SLACK_SIGNING_SECRET", SECRET);
  vi.stubEnv("SLACK_TEAM_ID", PRIMARY_TEAM);
  dataset = new InMemoryDataset();
  dataset.slackWorkspaces.push({ id: "slws_AAAAAAAAAAA2", team_id: SECOND_TEAM, name: "Second", url: null, is_primary: false, created_at: "2026-01-01T00:00:00Z", deleted_at: null });
});

describe("Slack webhook with two workspaces", () => {
  it("files each message under its own workspace, even when the channel id and timestamp are the same", async () => {
    expect((await send(message(PRIMARY_TEAM, T1, "from the first"))).status).toBe(200);
    expect((await send(message(SECOND_TEAM, T1, "from the second"))).status).toBe(200);

    const primaryId = dataset.slackWorkspaces.find((w) => w.is_primary)!.id;
    expect(dataset.slackMessages.map((m) => [m.workspace_id, m.text])).toEqual([
      [primaryId, "from the first"],
      ["slws_AAAAAAAAAAA2", "from the second"],
    ]);

    // The same event delivered again is idempotent per workspace.
    await send(message(SECOND_TEAM, T1, "from the second"));
    expect(dataset.slackMessages).toHaveLength(2);
  });

  it("applies an edit and a deletion to the workspace the event came from only", async () => {
    await send(message(PRIMARY_TEAM, T1, "first"));
    await send(message(SECOND_TEAM, T1, "second"));

    await send({
      type: "event_callback",
      team_id: SECOND_TEAM,
      event: { type: "message", subtype: "message_deleted", channel: SAME_CHANNEL, deleted_ts: T1, ts: T3, event_ts: T3 },
    });

    const second = dataset.slackMessages.find((m) => m.workspace_id === "slws_AAAAAAAAAAA2");
    const first = dataset.slackMessages.find((m) => m.workspace_id !== "slws_AAAAAAAAAAA2");
    expect(second?.deleted_at).toBeTruthy();
    expect(first?.deleted_at ?? null).toBeNull();
  });

  it("refuses an event from a workspace the Hub does not know, and stores nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await send(message("T_STRANGER", T1, "who are you"));
    expect(await response.json()).toMatchObject({ received: true, ignored: "unknown_workspace" });
    expect(dataset.slackMessages).toEqual([]);

    // No team id at all is refused too.
    const noTeam = message(PRIMARY_TEAM, T2, "no team");
    delete (noTeam as { team_id?: string }).team_id;
    expect(await (await send(noTeam)).json()).toMatchObject({ ignored: "unknown_workspace" });
    expect(dataset.slackMessages).toEqual([]);
  });
});
