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
import { aPrickle } from "../helpers/prickle-fixture";

const ADA = "mbr_AAAAAAAAAAA1";
const PRICKLE = "prkl_AAAAAAAAAAA1";

function send(action: Record<string, unknown>) {
  const payload = {
    type: "block_actions",
    user: { id: "U_ADA" },
    channel: { id: "D1" },
    message: { ts: "1700000000.000100" },
    actions: [action],
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  return POST(new NextRequest("http://localhost/api/webhooks/slack/interactions", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
}

const press = (value: string) => send({ action_id: "prickle_submit", value });

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({ prickles: [aPrickle(PRICKLE)] });
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

describe("A DM about a prickle that no longer exists", () => {
  const outOfDate = expect.objectContaining({ channel: "D1", ts: "1700000000.000100", text: expect.stringContaining("out of date") });

  beforeEach(() => {
    // The prickle was rebuilt under another id after the DM went out: nothing is in the dataset.
    dataset = new InMemoryDataset();
    repos = createInMemoryRepos(dataset);
  });

  it("replaces the message with a note on Submit, and saves nothing", async () => {
    await press(`checkout:${PRICKLE}`);

    expect(update).toHaveBeenCalledWith(outOfDate);
    expect(await repos.prickleActivity.dismissedAmong("checkout", ADA, [PRICKLE])).toEqual(new Set());
  });

  it("replaces the message with a note on Skip, and saves nothing", async () => {
    await send({ action_id: "prickle_dismiss", value: `checkin:${PRICKLE}` });

    expect(update).toHaveBeenCalledWith(outOfDate);
    expect(await repos.prickleActivity.dismissedAmong("checkin", ADA, [PRICKLE])).toEqual(new Set());
  });

  it("replaces the message with a note when a question is answered, and saves nothing", async () => {
    await send({
      action_id: "prickle_checkin_answer",
      block_id: `prickle_checkin:${PRICKLE}:need`,
      type: "static_select",
      selected_option: { value: "company" },
    });

    expect(update).toHaveBeenCalledWith(outOfDate);
    expect(await repos.prickleActivity.checkinOf(ADA, PRICKLE)).toBeNull();
  });
});
