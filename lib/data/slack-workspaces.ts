import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText, must } from "./query";

/** One Slack workspace the Billie Bot app is installed in (`slack_workspaces`). No token: those live in Vault. */
export type SlackWorkspace = Row<"slack_workspaces">;

/** The id of the primary workspace in the in-memory twin (the database seeds its own). */
export const IN_MEMORY_PRIMARY_WORKSPACE_ID = "slws_AAAAAAAAAAA1";

/**
 * The Slack workspaces (`slack_workspaces`). Every Bronze Slack row says which workspace it came from; the
 * Slack repositories take a workspace id to scope themselves (`createRepos(db, { slackWorkspaceId })`).
 * Reads work for staff (RLS); writes need the service role. Throws on a database error.
 */
export interface SlackWorkspaceRegistry {
  /** Every live workspace, primary first, then by name. */
  list(): Promise<SlackWorkspace[]>;
  byId(id: string): Promise<SlackWorkspace | null>;
  /** The workspace Slack calls `teamId` (a webhook's `team_id`), or null when none is registered: the caller rejects it. */
  byTeamId(teamId: string): Promise<SlackWorkspace | null>;
  /** The primary workspace; null only if the seed row was removed. */
  primary(): Promise<SlackWorkspace | null>;
  /** Registers a workspace, or returns the one already registered for this team id (its name and url are refreshed). */
  register(workspace: { teamId: string; name: string; url?: string | null }): Promise<SlackWorkspace>;
  /** Records the primary workspace's team id (and url) the first time they are known. Does nothing once a team id is set. */
  recordPrimaryTeam(team: { teamId: string; name?: string | null; url?: string | null }): Promise<SlackWorkspace | null>;
}

const byPrimaryThenName = (a: SlackWorkspace, b: SlackWorkspace) =>
  Number(b.is_primary) - Number(a.is_primary) || compareText(a.name, b.name) || compareText(a.id, b.id);

export class SupabaseSlackWorkspaceRegistry implements SlackWorkspaceRegistry {
  constructor(private readonly db: Db) {}

  private get table() {
    return this.db.from("slack_workspaces");
  }

  async list() {
    return (must(await this.table.select("*").is("deleted_at", null)) ?? []).sort(byPrimaryThenName);
  }

  async byId(id: string) {
    return must(await this.table.select("*").eq("id", id).is("deleted_at", null).maybeSingle());
  }

  async byTeamId(teamId: string) {
    return must(await this.table.select("*").eq("team_id", teamId).is("deleted_at", null).maybeSingle());
  }

  async primary() {
    return must(await this.table.select("*").eq("is_primary", true).is("deleted_at", null).maybeSingle());
  }

  async register(workspace: { teamId: string; name: string; url?: string | null }) {
    const existing = await this.byTeamId(workspace.teamId);
    if (existing) {
      const update = { name: workspace.name, ...(workspace.url ? { url: workspace.url } : {}) };
      return must(await this.table.update(update).eq("id", existing.id).select("*").single()) as SlackWorkspace;
    }
    return must(await this.table.insert({ team_id: workspace.teamId, name: workspace.name, url: workspace.url ?? null }).select("*").single()) as SlackWorkspace;
  }

  async recordPrimaryTeam(team: { teamId: string; name?: string | null; url?: string | null }) {
    const primary = await this.primary();
    if (!primary || primary.team_id) return primary;
    return must(
      await this.table
        .update({ team_id: team.teamId, ...(team.name ? { name: team.name } : {}), ...(team.url ? { url: team.url } : {}) })
        .eq("id", primary.id)
        .is("team_id", null)
        .select("*")
        .single()
    );
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemorySlackWorkspaceRegistry implements SlackWorkspaceRegistry {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.slackWorkspaces.filter((w) => !w.deleted_at);
  }

  async list() {
    return this.live().map((w) => ({ ...w })).sort(byPrimaryThenName);
  }

  async byId(id: string) {
    const w = this.live().find((x) => x.id === id);
    return w ? { ...w } : null;
  }

  async byTeamId(teamId: string) {
    const w = this.live().find((x) => x.team_id === teamId);
    return w ? { ...w } : null;
  }

  async primary() {
    const w = this.live().find((x) => x.is_primary);
    return w ? { ...w } : null;
  }

  async register(workspace: { teamId: string; name: string; url?: string | null }) {
    const existing = this.live().find((x) => x.team_id === workspace.teamId);
    if (existing) {
      existing.name = workspace.name;
      if (workspace.url) existing.url = workspace.url;
      return { ...existing };
    }
    const row: SlackWorkspace = {
      id: `slws_${String(this.data.slackWorkspaces.length + 1).padStart(12, "B")}`,
      team_id: workspace.teamId,
      name: workspace.name,
      url: workspace.url ?? null,
      is_primary: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    this.data.slackWorkspaces.push(row);
    return { ...row };
  }

  async recordPrimaryTeam(team: { teamId: string; name?: string | null; url?: string | null }) {
    const primary = this.live().find((x) => x.is_primary);
    if (!primary) return null;
    if (!primary.team_id) {
      primary.team_id = team.teamId;
      if (team.name) primary.name = team.name;
      if (team.url) primary.url = team.url;
    }
    return { ...primary };
  }
}
