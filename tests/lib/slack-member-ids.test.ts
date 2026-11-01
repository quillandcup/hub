import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));

import { resolveSlackUserIds, resolveMemberIdForSlackUser } from "@/lib/slack-member-ids";

describe("notification Slack recipient matching", () => {
  it("rejects an ambiguous name instead of choosing a member", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "m1", name: "Alex River", email: "alex1@example.com" },
          { id: "m2", name: "Alex River", email: "alex2@example.com" },
        ],
        slackUsers: [{ user_id: "U1", real_name: "Alex River", email: null }],
      })
    );

    expect(await resolveSlackUserIds(repos, ["m1", "m2"])).toEqual(new Map());
    expect(await resolveMemberIdForSlackUser(repos, "U1")).toBeNull();
    expect(error).toHaveBeenCalledWith("[notifications] Ambiguous Slack member match", expect.objectContaining({ reason: "ambiguous_candidate" }));
    expect(captureMessage).toHaveBeenCalled();
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "ambiguous_slack_member_match", collisions: expect.any(Array) }));
    error.mockRestore();
  });

  it("rejects two Slack accounts matching the same member", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: "m1", name: "Alex River", email: "alex@example.com" }],
        slackUsers: [
          { user_id: "U1", real_name: "Alex River", email: "alex@example.com" },
          { user_id: "U2", real_name: "Alex River", email: "alex@example.com" },
        ],
      })
    );

    expect(await resolveSlackUserIds(repos, ["m1"])).toEqual(new Map());
    expect(error).toHaveBeenCalledWith("[notifications] Ambiguous Slack member match", expect.objectContaining({ reason: "multiple_slack_users" }));
    error.mockRestore();
  });

  it("honors an explicit Slack ID alias over a shared name", async () => {
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "m1", name: "Alex River", email: "alex1@example.com" },
          { id: "m2", name: "Alex River", email: "alex2@example.com" },
        ],
        nameAliases: [{ id: "nal_AAAAAAAAAAA1", member_id: "m1", alias: "U1", source: "slack", active: true }],
        slackUsers: [{ user_id: "U1", real_name: "Alex River", email: null }],
      })
    );

    expect(await resolveSlackUserIds(repos, ["m1", "m2"])).toEqual(new Map([["m1", "U1"]]));
  });
});
