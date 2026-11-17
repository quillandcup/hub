import { describe, it, expect, vi, beforeEach } from "vitest";

const { update, info, mark, config, getSlackUserToken, botToken, testMode } = vi.hoisted(() => ({
  update: vi.fn(),
  info: vi.fn(),
  mark: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
  botToken: { value: "xoxb-bot" as string | null },
  testMode: { value: false },
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return {
      chat: { update: (a: unknown) => update(a, token) },
      conversations: { info: (a: unknown) => info(a, token), mark: (a: unknown) => mark(a, token) },
    };
  }),
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  get isProduction() {
    return config.isProduction;
  },
}));
vi.mock("@/lib/slack", () => ({ isSlackTestMode: () => testMode.value }));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: async () => botToken.value }));
vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  getSlackUserToken: (...args: unknown[]) => getSlackUserToken(...args),
}));
const after = vi.hoisted(() => vi.fn((task: () => Promise<unknown>) => void task()));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => service }));

let dataset: import("@/lib/data/in-memory").InMemoryDataset;
let repos: import("@/lib/data/repos").Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { answeredHalves, closeCheckinDms, closeCheckinDmsAfterResponse } from "@/lib/prickle-checkin-dm-close";
import { closedDmBlocks } from "@/lib/prickle-checkin-dms";
import { EMPTY_CHECKIN } from "@/lib/prickle-checkins";

const rpc = vi.fn();
const service = { rpc: (name: string, args: unknown) => rpc(name, args) } as never;

const DM_TS = "1700000000.000200";
const ARGS = { memberId: "member-fern", prickleId: "prkl_test1", halves: ["checkin" as const] };
const slackError = (code: string) => Object.assign(new Error(code), { data: { error: code } });

/** A claimed check-in DM for the member, with (or without) its Slack message kept. */
async function claimedDm(opts: { ts?: boolean; kind?: "prickle_checkin" | "prickle_checkout" } = {}) {
  const kind = opts.kind ?? "prickle_checkin";
  await repos.prickleActivity.claimDm("prkl_test1", "member-fern", kind);
  if (opts.ts ?? true) await repos.prickleActivity.recordDmMessage("prkl_test1", "member-fern", kind, { channelId: "D_FERN", ts: DM_TS });
}
const closedAt = async (kind: "prickle_checkin" | "prickle_checkout" = "prickle_checkin") =>
  (await repos.prickleActivity.dmMessage("prkl_test1", "member-fern", kind))?.closedAt ?? null;

beforeEach(() => {
  dataset = new InMemoryDataset();
  repos = createInMemoryRepos(dataset);
  config.isProduction = true;
  testMode.value = false;
  botToken.value = "xoxb-bot";
  update.mockReset();
  update.mockResolvedValue({ ok: true });
  info.mockReset();
  info.mockResolvedValue({ ok: true, channel: { last_read: "1700000000.000100" } });
  mark.mockReset();
  mark.mockResolvedValue({ ok: true });
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue(null);
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  after.mockClear();
  vi.spyOn(console, "error").mockClear().mockImplementation(() => {});
});

describe("closeCheckinDms", () => {
  it("collapses the DM to the closed note and leaves the read marker alone for a member without a Slack connection", async () => {
    await claimedDm();

    await closeCheckinDms(service, ARGS);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ channel: "D_FERN", ts: DM_TS, ...closedDmBlocks("checkin", "prkl_test1") }, "xoxb-bot");
    expect(mark).not.toHaveBeenCalled();
    expect(await closedAt()).toEqual(expect.any(String));
  });

  it("also marks the DM read as the member when they connected Slack", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });

    await closeCheckinDms(service, ARGS);

    expect(update).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith({ channel: "D_FERN", ts: DM_TS }, "xoxp-fern");
  });

  it("closes the check-out half, and both halves of one save", async () => {
    await claimedDm({ kind: "prickle_checkout" });
    await claimedDm({ kind: "prickle_checkin" });

    await closeCheckinDms(service, { ...ARGS, halves: ["checkin", "checkout"] });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.map((c) => c[0].text).sort()).toEqual(["✅ Checked in. Thanks!", "✅ Checked out. Thanks!"]);
    expect(await closedAt("prickle_checkout")).not.toBeNull();
  });

  it("never moves the member's marker backward: leaves it when Slack already shows the DM as read", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
    info.mockResolvedValue({ ok: true, channel: { last_read: "1700000005.000000" } });

    await closeCheckinDms(service, ARGS);

    expect(update).toHaveBeenCalledTimes(1);
    expect(mark).not.toHaveBeenCalled();
  });

  it("does nothing for a DM sent before its message was kept, or for no DM at all", async () => {
    await claimedDm({ ts: false });
    await closeCheckinDms(service, ARGS);
    await closeCheckinDms(service, { ...ARGS, halves: ["checkout"] });

    expect(update).not.toHaveBeenCalled();
    expect(getSlackUserToken).not.toHaveBeenCalled();
    expect(await closedAt()).toBeNull();
  });

  it("does nothing the second time: a collapsed DM is not edited or marked again", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });

    await closeCheckinDms(service, ARGS);
    await closeCheckinDms(service, ARGS);

    expect(update).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside production, in Slack test mode, or without a bot token", async () => {
    await claimedDm();
    config.isProduction = false;
    await closeCheckinDms(service, ARGS);
    config.isProduction = true;
    testMode.value = true;
    await closeCheckinDms(service, ARGS);
    testMode.value = false;
    botToken.value = null;
    await closeCheckinDms(service, ARGS);

    expect(update).not.toHaveBeenCalled();
    expect(await closedAt()).toBeNull();
  });

  it("does nothing when no half was answered", async () => {
    await claimedDm();
    await closeCheckinDms(service, { ...ARGS, halves: [] });
    expect(update).not.toHaveBeenCalled();
  });

  it("swallows a Slack failure, leaves the DM open to try again, and does not mark it read", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
    update.mockRejectedValueOnce(slackError("internal_error"));

    await expect(closeCheckinDms(service, ARGS)).resolves.toBeUndefined();
    expect(await closedAt()).toBeNull();
    expect(mark).not.toHaveBeenCalled();

    await closeCheckinDms(service, ARGS); // the next answer collapses it
    expect(await closedAt()).not.toBeNull();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("stops trying for a message Slack no longer has", async () => {
    await claimedDm();
    update.mockRejectedValue(slackError("message_not_found"));

    await closeCheckinDms(service, ARGS);
    await closeCheckinDms(service, ARGS);

    expect(update).toHaveBeenCalledTimes(1);
    expect(await closedAt()).not.toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("revokes a connection whose token Slack says is dead, and stays quiet about a missing scope", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
    mark.mockRejectedValue(slackError("token_revoked"));
    await closeCheckinDms(service, ARGS);
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });

    dataset = new InMemoryDataset();
    repos = createInMemoryRepos(dataset);
    rpc.mockClear();
    await claimedDm();
    mark.mockRejectedValue(slackError("missing_scope"));
    await closeCheckinDms(service, ARGS);
    expect(rpc).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs a marker failure it does not recognise, without failing", async () => {
    await claimedDm();
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
    info.mockRejectedValue(slackError("fatal_error"));

    await expect(closeCheckinDms(service, ARGS)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("marking the DM read failed"), "member-fern", expect.anything());
  });

  it("survives the repository failing", async () => {
    repos.prickleActivity.dmMessage = async () => {
      throw new Error("db down");
    };
    await expect(closeCheckinDms(service, ARGS)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("answeredHalves", () => {
  it("names the halves a saved check-in has answered", () => {
    expect(answeredHalves(EMPTY_CHECKIN)).toEqual([]);
    expect(answeredHalves({ ...EMPTY_CHECKIN, pleasantBefore: 4, energyBefore: 3, need: "company" })).toEqual(["checkin"]);
    expect(answeredHalves({ ...EMPTY_CHECKIN, intentionMet: 3, pleasantAfter: 4, energyAfter: 3 })).toEqual(["checkout"]);
  });
});

describe("closeCheckinDmsAfterResponse", () => {
  it("runs after the response, and only when a half is named", async () => {
    await claimedDm();
    closeCheckinDmsAfterResponse({ ...ARGS, halves: [] });
    expect(after).not.toHaveBeenCalled();

    closeCheckinDmsAfterResponse(ARGS);
    expect(after).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });
});
