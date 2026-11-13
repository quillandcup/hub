import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseSlackMessageRepository } from "@/lib/data/slack-messages";
import { SupabaseSlackUserRepository } from "@/lib/data/slack-users";
import { SupabaseSlackWorkspaceRepository } from "@/lib/data/slack-workspace";
import { SupabaseSlackWorkspaceRegistry } from "@/lib/data/slack-workspaces";
import { defineSlackWorkspacesContract } from "@/tests/helpers/slack-workspaces-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const PREFIX = `UTWS${Date.now()}`;
let counter = 0;

const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// Everything the contract stores carries this run's prefix in a Slack id; its workspaces in their team id.
const clear = async () => {
  const bronze = db.schema("bronze");
  check((await bronze.from("slack_reactions").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await bronze.from("slack_messages").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await bronze.from("slack_channels").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await bronze.from("slack_users").delete().like("user_id", `${PREFIX}%`)).error);
  check((await db.from("slack_workspaces").delete().like("team_id", `${PREFIX}%`)).error);
};

afterAll(clear);

defineSlackWorkspacesContract("Supabase", () => ({
  registry: () => new SupabaseSlackWorkspaceRegistry(db),
  repos: (workspaceId) => ({
    messages: new SupabaseSlackMessageRepository(db, workspaceId),
    workspace: new SupabaseSlackWorkspaceRepository(db, workspaceId),
    users: new SupabaseSlackUserRepository(db, workspaceId),
  }),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  // The old single-workspace keys are still there (expand step), so two workspaces cannot yet hold the same Slack id.
  idsMayCollide: false,
}));

describe("SupabaseSlackWorkspaceRegistry: the primary workspace's team id", () => {
  it("is recorded once and never changed afterwards; the seeded row has none until then", async () => {
    const registry = new SupabaseSlackWorkspaceRegistry(db);
    const before = await registry.primary();
    expect(before?.is_primary).toBe(true);
    if (before?.team_id) {
      // Another run recorded it: nothing to change.
      expect((await registry.recordPrimaryTeam({ teamId: `${PREFIX}OTHER` }))?.team_id).toBe(before.team_id);
      return;
    }
    try {
      const teamId = `${PREFIX}PRIMARY`;
      expect((await registry.recordPrimaryTeam({ teamId, name: "Main workspace" }))?.team_id).toBe(teamId);
      expect((await registry.recordPrimaryTeam({ teamId: `${PREFIX}OTHER` }))?.team_id).toBe(teamId);
      expect((await registry.byTeamId(teamId))?.is_primary).toBe(true);
    } finally {
      // Put the seeded row back as it was, so other suites start from the same place.
      check((await db.from("slack_workspaces").update({ team_id: null, name: before?.name ?? "Primary workspace" }).eq("is_primary", true)).error);
    }
  });
});
