import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The Submit button on a check-in or check-out DM: the answers are already saved, so it closes the
// offer everywhere and collapses the message.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/slack-signature", () => ({ verifySlackSignature: () => ({ valid: true }) }));
const resolveMember = vi.fn();
vi.mock("@/lib/slack-member-ids", () => ({ resolveMemberIdForSlackUser: (...args: unknown[]) => resolveMember(...args) }));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: async () => "xoxb-test" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const update = vi.fn(async () => ({ ok: true }));
vi.mock("@slack/web-api", () => ({ WebClient: class { chat = { update }; } }));

import { POST } from "@/app/api/webhooks/slack/interactions/route";

const ADA = "mbr_AAAAAAAAAAA1";
const PRICKLE = "prkl_AAAAAAAAAAA1";

function press(value: string) {
  const payload = {
    type: "block_actions",
    user: { id: "U_ADA" },
    channel: { id: "D1" },
    message: { ts: "1700000000.000100" },
    actions: [{ action_id: "prickle_submit", value }],
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  return POST(new NextRequest("http://localhost/api/webhooks/slack/interactions", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset();
  repos = createInMemoryRepos(dataset);
  resolveMember.mockResolvedValue(ADA);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Submit on a check-in or check-out DM", () => {
  it("closes the check-in everywhere and collapses the message", async () => {
    const res = await press(`checkin:${PRICKLE}`);

    expect(res.status).toBe(200);
    expect([...(await repos.prickleActivity.dismissedAmong("checkin", ADA, [PRICKLE]))]).toEqual([PRICKLE]);
    expect(await repos.prickleActivity.dismissedAmong("checkout", ADA, [PRICKLE])).toEqual(new Set());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", ts: "1700000000.000100", text: "✅ Checked in. Thanks!" }));
  });

  it("closes the check-out half for a check-out DM", async () => {
    await press(`checkout:${PRICKLE}`);

    expect([...(await repos.prickleActivity.dismissedAmong("checkout", ADA, [PRICKLE]))]).toEqual([PRICKLE]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ text: "✅ Checked out. Thanks!" }));
  });

  it("changes nothing when the Slack user matches no member", async () => {
    resolveMember.mockResolvedValue(null);

    await press(`checkin:${PRICKLE}`);

    expect(await repos.prickleActivity.dismissedAmong("checkin", ADA, [PRICKLE])).toEqual(new Set());
    expect(update).not.toHaveBeenCalled();
  });
});
