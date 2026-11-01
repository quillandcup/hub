import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The check-out DM's progress answer (a number typed into a Slack input): saved as an entry on the
// matched member's own project, with the same engagement row as logging it in the Hub.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/slack-signature", () => ({ verifySlackSignature: () => ({ valid: true }) }));
const resolveMember = vi.fn();
vi.mock("@/lib/slack-member-ids", () => ({ resolveMemberIdForSlackUser: (...args: unknown[]) => resolveMember(...args) }));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: async () => null }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { POST } from "@/app/api/webhooks/slack/interactions/route";

const ADA = "mbr_AAAAAAAAAAA1";
const FERN = "mbr_AAAAAAAAAAA2";
const project = (id: string, member: string) => ({
  id, member_id: member, title: "Novel", description: null, cover_asset_id: null, cover_url: null, external_id: null, phase: "drafting", show_on_profile: false, archived_at: null, created_at: "2026-01-01T00:00:00Z",
});

function answer(projectId: string, amount = "250") {
  const action = { action_id: "writing_quick_log", block_id: `quick_log:prkl_AAAAAAAAAAA1:${projectId}:words`, value: amount };
  const body = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", user: { id: "U_ADA" }, actions: [action] }) }).toString();
  return POST(new NextRequest("http://localhost/api/webhooks/slack/interactions", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({ writingProjects: [project("wprj_1", ADA), project("wprj_2", FERN)] });
  repos = createInMemoryRepos(dataset);
  resolveMember.mockResolvedValue(ADA);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("writing quick log from a Slack DM", () => {
  it("saves the number as an entry on the member's project, and records the activity", async () => {
    const res = await answer("wprj_1");

    expect(res.status).toBe(200);
    expect(dataset.writingEntries.map((e) => [e.member_id, e.project_id, e.measure, e.mode, e.amount, e.prickle_id])).toEqual([[ADA, "wprj_1", "words", "delta", 250, "prkl_AAAAAAAAAAA1"]]);
    expect(dataset.activities).toEqual([expect.objectContaining({ member_id: ADA, activity_type: "writing_progress_logged", related_id: dataset.writingEntries[0].id })]);
  });

  it("writes nothing to a project that isn't the matched member's", async () => {
    await answer("wprj_2");

    expect(dataset.writingEntries).toEqual([]);
    expect(dataset.activities).toEqual([]);
  });

  it("writes nothing when the ownership check itself fails", async () => {
    vi.spyOn(repos.writing, "ownsProject").mockRejectedValue(new Error("db down"));

    await answer("wprj_1");

    expect(dataset.writingEntries).toEqual([]);
  });

  it("records no activity when the entry can't be saved", async () => {
    vi.spyOn(repos.writing, "addEntry").mockRejectedValue(new Error("db down"));

    const res = await answer("wprj_1");

    expect(res.status).toBe(200);
    expect(dataset.activities).toEqual([]);
  });
});
