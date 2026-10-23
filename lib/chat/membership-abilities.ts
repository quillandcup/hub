/** What the viewer may do about a conversation's members, for the members page to show the right controls. */
export interface MembershipAbilities {
  /** Why nothing can be changed (a group message, archived, not connected to Slack, viewing as someone else), or null. */
  blocked: string | null;
  canJoin: boolean;
  canLeave: boolean;
  canAdd: boolean;
  canRemoveOthers: boolean;
}

const NONE: MembershipAbilities = { blocked: null, canJoin: false, canLeave: false, canAdd: false, canRemoveOthers: false };

/**
 * The controls the members page offers. Only decides what to show: the actions (membership-actions.ts)
 * check every one of these again, since they are endpoints anyone signed in can call.
 */
export function membershipAbilities(args: {
  kind: "channel" | "dm" | "group_dm";
  visibility: "public" | "private";
  archived: boolean;
  joined: boolean;
  /** chat_posting is on for the viewed member. */
  postingOn: boolean;
  isSudo: boolean;
  isStaff: boolean;
  /** The conversation's bridge to Slack: null when it can't be read. */
  bridge: { bridge_mode: string; bridge_disabled: boolean; bridge_status: string } | null;
  slackChannelId: string | null;
}): MembershipAbilities {
  if (!args.postingOn) return NONE;
  if (args.isSudo) return { ...NONE, blocked: "You can't change a conversation's members while viewing as another member." };
  if (args.kind !== "channel") return { ...NONE, blocked: "Slack doesn't allow changing who is in a group message." };
  if (args.archived) return { ...NONE, blocked: "This conversation is archived." };
  const bridged = args.bridge?.bridge_mode === "bridged" && !args.bridge.bridge_disabled && args.bridge.bridge_status === "ok" && Boolean(args.slackChannelId);
  if (!bridged) return { ...NONE, blocked: "This conversation isn't connected to Slack, so its members can't be changed from here." };

  return {
    blocked: null,
    canJoin: !args.joined && args.visibility === "public",
    canLeave: args.joined,
    canAdd: args.joined,
    canRemoveOthers: args.isStaff,
  };
}
