import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

/** triggerSlackSync imports every registered Slack workspace, one request each, and reports a failure after trying them all. */
const importRoute = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock("@/app/api/import/slack-api/route", () => importRoute);
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { triggerSlackSync } from "@/lib/processing/trigger";

const requested = async () => (await Promise.all(importRoute.POST.mock.calls.map(([req]) => req.json()))).map((b) => b.workspace);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const second = { id: "slws_AAAAAAAAAAA2", team_id: "T_SECOND", name: "Second", url: null, is_primary: false, created_at: "2026-01-01T00:00:00Z", deleted_at: null };

beforeEach(() => {
  dataset = new InMemoryDataset();
  importRoute.POST.mockReset();
  vi.stubEnv("SLACK_TEAM_ID", "T_PRIMARY");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("triggerSlackSync", () => {
  it("imports the primary workspace alone while it is the only one, returning its result as before", async () => {
    importRoute.POST.mockResolvedValue(reply({ success: true, messages: 3 }));
    expect(await triggerSlackSync({ daysBack: 7 })).toEqual({ success: true, messages: 3 });
    expect(await requested()).toEqual(["primary"]);
  });

  it("imports every registered workspace in turn, the primary's result first", async () => {
    dataset.slackWorkspaces.push({ ...second });
    // A workspace the bot isn't installed in yet (no team id) is skipped.
    dataset.slackWorkspaces.push({ ...second, id: "slws_AAAAAAAAAAA3", team_id: null, name: "Not installed" });
    importRoute.POST.mockImplementation(async (req: Request) => reply({ success: true, workspace: (await req.clone().json()).workspace }));

    const result = await triggerSlackSync({ daysBack: 90 });

    expect(await requested()).toEqual(["primary", "T_SECOND"]);
    expect(result).toMatchObject({ workspace: "primary", otherWorkspaces: [{ workspace: "Second", success: true }] });
  });

  it("imports just the workspace asked for", async () => {
    dataset.slackWorkspaces.push({ ...second });
    importRoute.POST.mockResolvedValue(reply({ success: true }));
    await triggerSlackSync({ daysBack: 1, workspace: "T_SECOND" });
    expect(await requested()).toEqual(["T_SECOND"]);
  });

  it("tries the other workspaces when one fails, then raises the failure", async () => {
    dataset.slackWorkspaces.push({ ...second });
    importRoute.POST.mockImplementation(async (req: Request) => {
      const { workspace } = await req.clone().json();
      return workspace === "primary" ? reply({ error: "token expired" }, 500) : reply({ success: true });
    });
    await expect(triggerSlackSync({ daysBack: 90 })).rejects.toThrow(/Slack sync failed \(primary\)/);
    expect(await requested()).toEqual(["primary", "T_SECOND"]);
  });
});
