import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseUnfurls, type BlocksUnfurl } from "@/lib/chat/unfurls";
import { isDmActionId } from "@/lib/chat/dm-controls";
import {
  buildCheckinBlocks,
  buildCheckoutBlocks,
  CHECKIN_ANSWER_ACTION_ID,
  DISMISS_ACTION_ID,
  QUICK_LOG_ACTION_ID,
  SUBMIT_ACTION_ID,
} from "@/lib/prickle-checkin-dms";

const PRICKLE = "prkl_AAAAAAAAAAA1";
const blocksOf = (blocks: unknown[]) => (parseUnfurls({ blocks }, { bot: true, body: "" }).unfurls[0] as BlocksUnfurl).blocks;

describe("DM action ids", () => {
  it("match exactly the ids the DM builders use, and nothing else", () => {
    for (const id of [CHECKIN_ANSWER_ACTION_ID, `${CHECKIN_ANSWER_ACTION_ID}:3`, SUBMIT_ACTION_ID, DISMISS_ACTION_ID, QUICK_LOG_ACTION_ID]) expect(isDmActionId(id)).toBe(true);
    for (const id of ["approve", "prickle_checkin_answerX", "", 3, null]) expect(isDmActionId(id)).toBe(false);
  });
});

describe("parsing the check-in and check-out DMs as controls", () => {
  it("draws the check-in's scales, feeling list, intention list and Submit/Skip as controls", () => {
    const blocks = blocksOf(buildCheckinBlocks(PRICKLE, "Midnight Crew", { pleasantBefore: 4, skipped: [] } as never));
    const rows = blocks.filter((b) => b.type === "controls");
    expect(rows.length).toBe(3);
    const scale = rows[0] as Extract<(typeof blocks)[number], { type: "controls" }>;
    expect(scale.blockId).toBe(`prickle_checkin:${PRICKLE}:pleasant_before`);
    const picked = scale.items.flatMap((i) => (i.kind === "press" && i.button.style === "primary" ? [i.button.value] : []));
    expect(picked).toEqual(["4"]);
    expect(scale.items.at(-1)).toMatchObject({ kind: "press", button: { label: "Skip", value: "skip" } });

    const selects = blocks.filter((b) => b.type === "select") as Extract<(typeof blocks)[number], { type: "select" }>[];
    expect(selects.length).toBe(2);
    expect(selects[0].placeholder).toBe("Type or pick a feeling");
    expect(selects[0].groups.length).toBeGreaterThan(5);
    expect(selects[0].groups.reduce((n, g) => n + g.options.length, 0)).toBeGreaterThan(70);
    expect(selects[1].groups).toHaveLength(1);

    const last = rows.at(-1) as Extract<(typeof blocks)[number], { type: "controls" }>;
    expect(last.items.map((i) => (i.kind === "press" ? i.button.label : ""))).toEqual(["Submit", "Skip check-in"]);
    expect(blocks.some((b) => b.type === "unsupported")).toBe(false);
  });

  it("draws the check-out's number input", () => {
    const blocks = blocksOf(buildCheckoutBlocks(PRICKLE, "Pop-Up Prickle", null, [{ projectId: "wpr_AAAAAAAAAAA1", projectTitle: "My Novel", measure: "words" } as never]));
    const input = blocks.find((b) => b.type === "number_input");
    expect(input).toMatchObject({ type: "number_input", actionId: QUICK_LOG_ACTION_ID, min: 0 });
    expect(blocks.some((b) => b.type === "unsupported")).toBe(false);
  });

  it("leaves another app's buttons, selects and inputs as they were (unsupported or link only)", () => {
    const blocks = blocksOf([
      { type: "actions", block_id: "b", elements: [{ type: "button", action_id: "approve", value: "1", text: { type: "plain_text", text: "Approve" } }] },
      { type: "section", block_id: "s", text: { type: "mrkdwn", text: "Pick" }, accessory: { type: "static_select", action_id: "pick", options: [{ text: { type: "plain_text", text: "A" }, value: "a" }] } },
      { type: "input", block_id: "i", label: { type: "plain_text", text: "n" }, element: { type: "number_input", action_id: "n" } },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["section", "unsupported"]);
  });

  it("drops a control without a block id or with a malformed option", () => {
    const blocks = blocksOf([
      { type: "actions", elements: [{ type: "button", action_id: SUBMIT_ACTION_ID, value: "checkin:p", text: { type: "plain_text", text: "Submit" } }] },
      { type: "section", block_id: "s", text: { type: "mrkdwn", text: "Q" }, accessory: { type: "static_select", action_id: CHECKIN_ANSWER_ACTION_ID, options: [{ text: 3, value: 4 }] } },
    ]);
    expect(blocks.some((b) => b.type === "controls" || b.type === "select")).toBe(false);
  });
});

// ---- the endpoint's checks -------------------------------------------------------------------------------------------

const loaded = vi.hoisted(() => ({ channel: null as unknown, message: null as unknown }));
vi.mock("@/lib/chat/load", async (orig) => ({
  ...(await orig<typeof import("@/lib/chat/load")>()),
  loadChannelForMember: vi.fn(async () => loaded.channel),
  loadMessage: vi.fn(async () => loaded.message),
}));
const handled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prickle-dm-interactions", () => ({ handleDmInteraction: handled }));

import { pressDmControl } from "@/lib/chat/dm-controls-press";

const CHN = "chn_AAAAAAAAAAA1";
const MSG = "msg_AAAAAAAAAAA1";
const stored = buildCheckinBlocks(PRICKLE, "Midnight Crew", null);
const scaleBlockId = `prickle_checkin:${PRICKLE}:pleasant_before`;
const updateSlack = vi.fn(async () => {});
const deps = () => ({ viewer: {} as never, service: {} as never, memberId: "mbr_AAAAAAAAAAA1", updateSlack });
const press = { channelId: CHN, messageId: MSG, blockId: scaleBlockId, actionId: `${CHECKIN_ANSWER_ACTION_ID}:3`, value: "999" };
const botMessage = (over: Record<string, unknown> = {}) => ({
  id: MSG,
  author_member_id: null,
  origin: "slack",
  slack_ts: "1.1",
  deleted_at: null,
  chat_message_contents: { body: "text", blocks: stored, bot: { name: "Billie Bot" } },
  ...over,
});

describe("pressDmControl", () => {
  beforeEach(() => {
    loaded.channel = { id: CHN, kind: "dm", slackChannelId: "D1" };
    loaded.message = botMessage();
    handled.mockReset();
    updateSlack.mockClear();
    handled.mockImplementation(async (i: { action: unknown; update: (m: { text: string; blocks: unknown[] }) => Promise<void> }) => {
      await i.update({ text: "t", blocks: stored });
      return "handled";
    });
  });

  it("runs the shared handler as the viewer with the stored button value, and returns the new blocks", async () => {
    const result = await pressDmControl(deps(), press);
    expect(result).toMatchObject({ ok: true, unfurl: { kind: "blocks" } });
    const call = handled.mock.calls[0][0];
    expect(call.memberId).toBe("mbr_AAAAAAAAAAA1");
    expect(call.action).toMatchObject({ type: "button", action_id: press.actionId, block_id: scaleBlockId, value: "3" });
    expect(updateSlack).toHaveBeenCalledWith("D1", "1.1", expect.objectContaining({ text: "t" }));
  });

  it("refuses malformed requests, unknown action ids and controls the message does not have", async () => {
    for (const bad of [{ ...press, channelId: "x" }, { ...press, messageId: "x" }, { ...press, actionId: "approve" }, { ...press, blockId: "" }, { ...press, value: "x".repeat(400) }, { ...press, blockId: "nope" }, { ...press, actionId: `${CHECKIN_ANSWER_ACTION_ID}:9` }]) {
      expect(await pressDmControl(deps(), bad)).toMatchObject({ ok: false });
    }
    expect(handled).not.toHaveBeenCalled();
  });

  it("refuses a channel the viewer cannot see or that is not a direct message", async () => {
    loaded.channel = null;
    expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
    loaded.channel = { id: CHN, kind: "channel", slackChannelId: "C1" };
    expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
    expect(handled).not.toHaveBeenCalled();
  });

  it("refuses a message that is not a bot's, is written by a person, deleted, or has no Slack copy", async () => {
    for (const over of [
      { chat_message_contents: { body: "t", blocks: stored } },
      { author_member_id: "mbr_AAAAAAAAAAA2" },
      { origin: "app" },
      { deleted_at: "2026-01-01" },
      { slack_ts: null },
    ]) {
      loaded.message = botMessage(over);
      expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
    }
    loaded.message = null;
    expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
    expect(handled).not.toHaveBeenCalled();
  });

  it("only accepts a select option the stored list has, and a cleared select", async () => {
    const need = stored.find((b) => b.block_id === `prickle_checkin:${PRICKLE}:need`);
    const base = { ...press, blockId: need.block_id, actionId: CHECKIN_ANSWER_ACTION_ID, value: undefined };
    expect(await pressDmControl(deps(), { ...base, selectedValue: "not-an-option" })).toMatchObject({ ok: false });
    const good = need.accessory.options[0].value;
    expect(await pressDmControl(deps(), { ...base, selectedValue: good })).toMatchObject({ ok: true });
    expect(handled.mock.calls[0][0].action).toMatchObject({ type: "static_select", selected_option: { value: good } });
    expect(await pressDmControl(deps(), base)).toMatchObject({ ok: true });
    expect(handled.mock.calls[1][0].action.selected_option).toBeUndefined();
  });

  it("fails when the handler wrote nothing back or did not recognise the action", async () => {
    handled.mockResolvedValue("handled");
    expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
    handled.mockResolvedValue("ignored");
    expect(await pressDmControl(deps(), press)).toMatchObject({ ok: false });
  });
});
