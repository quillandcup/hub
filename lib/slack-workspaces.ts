import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { SlackWorkspace } from "@/lib/data/slack-workspaces";
import { SLACK_WORKSPACE_URL } from "@/lib/config";

/**
 * Which Slack workspace something belongs to. The Billie Bot app is installed in several (docs/SLACK_WORKSPACES.md);
 * every Bronze Slack row carries the workspace it came from.
 */

/**
 * The primary workspace, with its Slack team id filled in. The migration seeds the row without the team id (a public
 * repo holds no workspace ids); the first call that knows it records `SLACK_TEAM_ID`, the environment value that
 * already names this workspace. Null only when the seed row was removed.
 */
export async function ensurePrimaryWorkspace(service: SupabaseClient): Promise<SlackWorkspace | null> {
  const registry = createRepos(service).slackWorkspaces;
  const primary = await registry.primary();
  if (!primary || primary.team_id) return primary;
  const teamId = process.env.SLACK_TEAM_ID;
  if (!teamId) return primary;
  return (await registry.recordPrimaryTeam({ teamId, url: SLACK_WORKSPACE_URL })) ?? primary;
}

/**
 * The registered workspace an event from Slack came from (the payload's `team_id`), or null when it is not one of
 * ours or has no team id: the webhook refuses it. A webhook is the first place the primary workspace's team id can be
 * learned for certain, so it is recorded here when `SLACK_TEAM_ID` names it.
 */
export async function resolveWebhookWorkspace(service: SupabaseClient, teamId: unknown): Promise<SlackWorkspace | null> {
  if (typeof teamId !== "string" || teamId === "") return null;
  const registry = createRepos(service).slackWorkspaces;
  const known = await registry.byTeamId(teamId);
  if (known) return known;
  if (teamId === process.env.SLACK_TEAM_ID) {
    const primary = await ensurePrimaryWorkspace(service);
    return primary?.team_id === teamId ? primary : null;
  }
  return null;
}
