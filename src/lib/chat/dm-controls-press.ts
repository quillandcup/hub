import { isId } from "@/lib/ids";
import { botOf, contentOf, loadChannelForMember, loadMessage, type ChatLoadRepos } from "@/lib/chat/load";
import { isDmActionId, MAX_DM_CONTROL_STRING, type DmControlPress } from "@/lib/chat/dm-controls";
import { parseUnfurls, type BlocksUnfurl } from "@/lib/chat/unfurls";
import { handleDmInteraction } from "@/lib/prickle-dm-interactions";
import type { Repos } from "@/lib/data/repos";

/**
 * A press of a control drawn in the Hub chat from one of Billie Bot's check-in or check-out DMs (src/components/chat/DmControls.tsx):
 * the answer is saved and the Slack message updated by the same handlers Slack's own buttons reach (src/lib/prickle-dm-interactions.ts).
 * Nothing in the request is trusted beyond which control it names: the message is loaded as the viewer (so RLS applies), must be
 * a bot's message in the viewer's own direct message, and the control must exist in the message as stored, which also supplies the
 * button's value and the select's options.
 */

export type DmControlResult =
  | { ok: true; /** The message's blocks as they now stand, so the card shows the answer before the Slack copy has come back. */ unfurl: BlocksUnfurl | null }
  | { ok: false; error: string };

const GENERIC = "That didn't work. Try again, or answer in Slack.";
const GONE = "That message isn't available.";

const isRecord = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The element of `block` with this action id (a section's accessory, an input's element, or one of an actions block's elements). */
function elementOf(block: Record<string, any>, actionId: string): Record<string, any> | null {
  const candidates: unknown[] = [block.accessory, block.element, ...(Array.isArray(block.elements) ? block.elements : [])];
  return candidates.find((e): e is Record<string, any> => isRecord(e) && e.action_id === actionId) ?? null;
}

export interface PressDeps {
  /** The viewer's own client's repositories: RLS decides what they can read. */
  viewer: ChatLoadRepos;
  /** Service role, for the same writes Slack's webhook makes. */
  service: Repos;
  /** The signed-in member (never read from the request). */
  memberId: string;
  /** Replaces a Slack message (`chat.update`). */
  updateSlack: (slackChannelId: string, ts: string, message: { text: string; blocks: any[] }) => Promise<void>;
}

export async function pressDmControl(deps: PressDeps, press: DmControlPress): Promise<DmControlResult> {
  const { channelId, messageId, blockId, actionId, value, selectedValue } = press ?? ({} as Partial<DmControlPress>);
  const strings = [blockId, actionId, value, selectedValue];
  if (
    !isId(channelId, "chn") ||
    !isId(messageId, "msg") ||
    strings.some((s) => s !== undefined && (typeof s !== "string" || s.length > MAX_DM_CONTROL_STRING)) ||
    !blockId ||
    !isDmActionId(actionId)
  ) {
    return { ok: false, error: GENERIC };
  }

  const channel = await loadChannelForMember(deps.viewer, channelId, deps.memberId, false);
  if (!channel || channel.kind !== "dm" || !channel.slackChannelId) return { ok: false, error: GONE };
  const row = await loadMessage(deps.viewer, channelId, messageId);
  const content = row ? contentOf(row) : null;
  // A message the bot posted (nobody in the Hub wrote it), still there, with a Slack copy to update.
  if (!row || !content || row.deleted_at || !row.slack_ts || row.author_member_id !== null || row.origin === "app" || !botOf(content.bot)) return { ok: false, error: GONE };

  const blocks = Array.isArray(content.blocks) ? (content.blocks as any[]) : [];
  const block = blocks.find((b) => isRecord(b) && b.block_id === blockId);
  const element = block ? elementOf(block, actionId) : null;
  if (!block || !element) return { ok: false, error: GENERIC };

  let action: Record<string, unknown>;
  if (element.type === "button") {
    // The value is the stored one, not the request's.
    action = { type: "button", action_id: actionId, block_id: blockId, value: element.value };
  } else if (element.type === "static_select") {
    const options: any[] = [...(element.options ?? []), ...(element.option_groups ?? []).flatMap((g: any) => g?.options ?? [])];
    const picked = selectedValue === undefined ? null : options.find((o) => o?.value === selectedValue);
    if (selectedValue !== undefined && !picked) return { ok: false, error: GENERIC };
    action = { type: "static_select", action_id: actionId, block_id: blockId, ...(picked ? { selected_option: picked } : {}) };
  } else if (element.type === "number_input") {
    if (typeof value !== "string") return { ok: false, error: GENERIC };
    action = { type: "number_input", action_id: actionId, block_id: blockId, value };
  } else {
    return { ok: false, error: GENERIC };
  }

  let last: { text: string; blocks: any[] } | null = null;
  const slackChannelId = channel.slackChannelId;
  const slackTs = row.slack_ts;
  const result = await handleDmInteraction({
    repos: deps.service,
    memberId: deps.memberId,
    action,
    blocks,
    text: content.body ?? "",
    update: async (message) => {
      await deps.updateSlack(slackChannelId, slackTs, message);
      last = message;
    },
  });
  // Nothing was written back: the answer was refused (a prickle that is gone is the exception, that replaces the message) or not saved.
  if (result === "ignored" || !last) return { ok: false, error: GENERIC };
  const shown = parseUnfurls({ blocks: (last as { blocks: any[] }).blocks }, { bot: true, body: "" }).unfurls.find((u): u is BlocksUnfurl => u.kind === "blocks");
  return { ok: true, unfurl: shown ?? null };
}
