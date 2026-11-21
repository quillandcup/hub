import { RETURN_PARAM } from "@/lib/gates";

/**
 * The existing Slack connect flow (`/api/oauth/slack/start`), coming back to Hedgie Care. Not a gate of its own: nothing here is
 * mandatory (a care plan works without it, the DM only fills in who spoke last), so there is nothing to decline either. The
 * destination rides through Slack and back the way the gate standard describes (`.claude/rules/gates-and-return-to.md`).
 */
export const CARE_SLACK_CONNECT_HREF = `/api/oauth/slack/start?${RETURN_PARAM}=${encodeURIComponent("/admin/care")}`;
