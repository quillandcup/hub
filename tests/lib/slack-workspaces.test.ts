import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { ensurePrimaryWorkspace, resolveWebhookWorkspace } from "@/lib/slack-workspaces";

const service = {} as never as import("@supabase/supabase-js").SupabaseClient;
const second = { id: "slws_AAAAAAAAAAA2", team_id: "T_SECOND", name: "Second", url: null, is_primary: false, created_at: "2026-01-01T00:00:00Z", deleted_at: null };

beforeEach(() => {
  dataset = new InMemoryDataset();
  vi.stubEnv("SLACK_TEAM_ID", "T_PRIMARY");
});
afterEach(() => vi.unstubAllEnvs());

describe("ensurePrimaryWorkspace", () => {
  it("records the team id the environment names on the seeded primary workspace, once", async () => {
    expect((await ensurePrimaryWorkspace(service))?.team_id).toBe("T_PRIMARY");
    vi.stubEnv("SLACK_TEAM_ID", "T_CHANGED");
    expect((await ensurePrimaryWorkspace(service))?.team_id).toBe("T_PRIMARY");
  });

  it("leaves the team id empty when the environment names none, and is null when there is no primary workspace", async () => {
    vi.stubEnv("SLACK_TEAM_ID", "");
    expect((await ensurePrimaryWorkspace(service))?.team_id).toBeNull();
    dataset.slackWorkspaces = [];
    expect(await ensurePrimaryWorkspace(service)).toBeNull();
  });
});

describe("resolveWebhookWorkspace", () => {
  it("finds a registered workspace by the event's team id", async () => {
    dataset.slackWorkspaces.push({ ...second });
    expect((await resolveWebhookWorkspace(service, "T_SECOND"))?.id).toBe(second.id);
  });

  it("recognises the primary workspace by SLACK_TEAM_ID and records its team id on first sight", async () => {
    const found = await resolveWebhookWorkspace(service, "T_PRIMARY");
    expect(found).toMatchObject({ is_primary: true, team_id: "T_PRIMARY" });
  });

  it("refuses a team that is not registered, an empty one and a missing one", async () => {
    expect(await resolveWebhookWorkspace(service, "T_STRANGER")).toBeNull();
    expect(await resolveWebhookWorkspace(service, "")).toBeNull();
    expect(await resolveWebhookWorkspace(service, undefined)).toBeNull();
    expect(await resolveWebhookWorkspace(service, 42)).toBeNull();
  });

  it("refuses the environment's team while the primary workspace is gone", async () => {
    dataset.slackWorkspaces = [];
    expect(await resolveWebhookWorkspace(service, "T_PRIMARY")).toBeNull();
  });

  it("does not let a soft-deleted workspace's team in", async () => {
    dataset.slackWorkspaces.push({ ...second, deleted_at: "2026-02-01T00:00:00Z" });
    expect(await resolveWebhookWorkspace(service, "T_SECOND")).toBeNull();
  });
});
