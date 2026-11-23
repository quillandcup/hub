import { CHAT_AVATAR_BUCKET, avatarPublicUrl, personPhotoUrl } from "@/lib/chat/avatar-url";

/** The public bucket holding our copies of Slack profile photos (see src/modules/chat/slack/avatar-copy.ts); core's name for it is `CHAT_AVATAR_BUCKET`. */
export const SLACK_AVATAR_BUCKET = CHAT_AVATAR_BUCKET;

export { avatarPublicUrl };

/** What to draw for a Slack user's photo: our copy once there is one, Slack's address until then. */
export const slackPhotoUrl = personPhotoUrl;
