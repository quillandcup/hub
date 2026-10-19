import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));

import { resolveSlackUserIds, resolveMemberIdForSlackUser } from "@/lib/slack-member-ids";

describe("notification Slack recipient matching", () => {
  it("rejects an ambiguous name instead of choosing a member", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({
      members: { data: [
        { id: "m1", name: "Alex River", email: "alex1@example.com" },
        { id: "m2", name: "Alex River", email: "alex2@example.com" },
      ] },
      "bronze.slack_users": { data: [{ user_id: "U1", real_name: "Alex River", email: null }] },
    });

    expect(await resolveSlackUserIds(fake, ["m1", "m2"])).toEqual(new Map());
    expect(await resolveMemberIdForSlackUser(fake, "U1")).toBeNull();
    expect(error).toHaveBeenCalledWith("[notifications] Ambiguous Slack member match", expect.objectContaining({ reason: "ambiguous_candidate" }));
    expect(captureMessage).toHaveBeenCalled();
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "ambiguous_slack_member_match", collisions: expect.any(Array) }));
    error.mockRestore();
  });

  it("rejects two Slack accounts matching the same member", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({
      members: { data: [{ id: "m1", name: "Alex River", email: "alex@example.com" }] },
      "bronze.slack_users": { data: [
        { user_id: "U1", real_name: "Alex River", email: "alex@example.com" },
        { user_id: "U2", real_name: "Alex River", email: "alex@example.com" },
      ] },
    });

    expect(await resolveSlackUserIds(fake, ["m1"])).toEqual(new Map());
    expect(error).toHaveBeenCalledWith("[notifications] Ambiguous Slack member match", expect.objectContaining({ reason: "multiple_slack_users" }));
    error.mockRestore();
  });

  it("honors an explicit Slack ID alias over a shared name", async () => {
    const fake = createFakeSupabase({
      members: { data: [
        { id: "m1", name: "Alex River", email: "alex1@example.com" },
        { id: "m2", name: "Alex River", email: "alex2@example.com" },
      ] },
      member_name_aliases: { data: [{ member_id: "m1", alias: "U1", source: "slack" }] },
      "bronze.slack_users": { data: [{ user_id: "U1", real_name: "Alex River", email: null }] },
    });

    expect(await resolveSlackUserIds(fake, ["m1", "m2"])).toEqual(new Map([["m1", "U1"]]));
  });
});
