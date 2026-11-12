export type FeatureKey = 'member_overrides' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'slack_admin_sign_in' | 'browser_notifications' | 'chat_dms' | 'chat_videos' | 'slack_dm_bridge' | 'big_sisters' | 'prickle_reminders' | 'checkin_dropins' | 'hosting' | 'writing_journey' | 'mux_playback_restriction' | 'mux_data' | 'changelog_digest' | 'chat_notifications' | 'chat_link_previews';

export interface FeaturePreview {
  key: FeatureKey;
  name: string;
  description: string;
}

export const FEATURE_PREVIEWS: FeaturePreview[] = [
  {
    key: 'member_overrides',
    name: 'Member Overrides',
    description: 'Suppress reconciliation mismatches (180 program, hiatus, gifted memberships)',
  },
  {
    key: 'hedgieversaries',
    name: 'Hedgieversaries',
    description: 'Track member Hedgieversary milestones — replaces the manual spreadsheet',
  },
  {
    key: 'work_queue',
    name: 'Admin Work Queue',
    description: 'Welcome-back, Hedgieversary celebration, and hiatus-nudge tasks, sorted by deadline',
  },
  {
    key: 'program_cohorts',
    name: 'Programs',
    description: 'Manage cohort-based program enrollment (180 Program, Self-Editing Academy, ...) and see who hasn\'t converted after their window lapsed',
  },
  {
    key: 'slack_admin_sign_in',
    name: 'Slack Sign-In for Admins',
    description: 'Lets you sign in to your admin account from Billie Bot (/hub or its Home tab), with links that last 10 minutes. Anyone who can use your Slack can then get into the Hub as you. Only your own opt-in counts: the global switch and segments do not turn this on',
  },
  {
    key: 'browser_notifications',
    name: 'Browser Notifications',
    description: 'Desktop and phone notifications from your browser, even when the Hub is closed (Web Push). Adds a "Browser" switch and a per-device "Turn on for this device" button to Settings → Notifications; a device only receives them once it has turned them on',
  },
  {
    key: 'chat_dms',
    name: 'Chat direct messages',
    description: 'Start a direct message with another member from their profile. Hub direct messages stay in the Hub (nothing goes to Slack), and staff cannot read them. Members you message see the conversation whether or not they have this on; this decides who can start one',
  },
  {
    key: 'chat_videos',
    name: 'Chat videos',
    description: 'Share a course lesson\'s video into a chat conversation, with a button on the lesson page. This decides who can share; any member who can read the message can see the card. Only members with access to the course can play it; everyone else sees that it is part of a course. In Slack the message shows a link to the lesson.',
  },
  {
    key: 'chat_link_previews',
    name: 'Chat link previews',
    description: 'A link in a message you send from Hub Chat gets a preview card under it (the page\'s title, description, site and picture; or the picture itself when the link points straight at one). This decides whose messages get previews: the Hub looks at the page once, right after the message is sent (never when someone reads it), and everyone who can read the message sees the card. Messages that come from Slack already carry Slack\'s own previews. For everyone else nothing is fetched and the link stays plain text',
  },
  {
    key: 'slack_dm_bridge',
    name: 'Slack DM bridge',
    description: 'Brings your one-on-one Slack direct messages into Hub Chat, read with your own Slack token (reconnect Slack first so it has the direct message permissions). They are restricted like private channels: only you and the other person, and staff only through break-glass access. Read-only for now.',
  },
  {
    key: 'big_sisters',
    name: 'Big Sisters',
    description: 'Every new member gets a big sister for their first 30 days: matching, volunteers and effectiveness for staff, plus a Big Sisters card on the dashboard, a Big Sisters page, an introduction message and a Getting Started step for members. Staff also need the Admin Work Queue to see who is waiting for a match',
  },
  {
    key: 'prickle_reminders',
    name: 'Send prickle reminders',
    description: 'Sends the reminder to put a prickle on your calendar (it backs off the longer it goes unanswered) for real to the members this covers: everyone when switched on globally, otherwise only members in a linked segment or with their own preview. For everyone else the job only logs who it would have reminded and why. Members also have to turn the reminders on themselves in Settings → Notifications, as they are off until then',
  },
  {
    key: 'changelog_digest',
    name: 'Send the weekly What\'s new digest',
    description: 'Sends the weekly roundup of new changelog entries for real to the members this covers: everyone when switched on globally, otherwise only members in a linked segment or with their own preview. For everyone else the job only logs who it would have sent it to and what it would have said (see the logs of /api/internal/changelog-digest). The post to the announcements channel goes out only when this is on for everyone. Members still choose their channels in Settings → Notifications',
  },
  {
    key: 'chat_notifications',
    name: 'Send chat notifications',
    description: 'Tells you about new direct messages, mentions and messages in the channels you follow in Hub Chat, on the channels you choose in Settings → Notifications, so Hub Chat can replace Slack for you. For members this covers (everyone when switched on globally, otherwise only members in a linked segment or with their own preview) the notifications go out for real and the Hub chat settings appear; for everyone else the sender only logs who it would have told and why (see the logs of the Slack webhook and the chat actions). Nothing is sent to a member who has not turned on "Hub chat is my main place" in Settings → Notifications, since Slack already tells them',
  },
  {
    key: 'checkin_dropins',
    name: 'Check-in for members who join a prickle',
    description: 'Sends the check-in (how are you feeling, what do you need) for real to a member who has joined the Zoom room of a prickle that started in the last 18 minutes without having it on their calendar, for the members this covers: everyone when switched on globally, otherwise only members in a linked segment or with their own preview. For everyone else the job only logs who it would have sent it to and why (see the logs of /api/internal/prickle-checkins). Members still choose their channels in Settings → Notifications',
  },
  {
    key: 'hosting',
    name: 'Hosting',
    description: 'Hosting for members: the Hosting tab in My Prickles (stats, monthly slot requests), the host vibe settings, and the hosting steps of the Getting started tour. Hidden until the change of process is agreed with the staff who run it; staff-side host tools are unaffected',
  },
  {
    key: 'writing_journey',
    name: 'Journey',
    description: 'The Journey tab in My Writing: the stages a book goes through at Quill & Cup (draft, edits, beta readers, publishing) with the Quill & Cup offer at each, and where each of your projects is on it',
  },
  {
    key: 'mux_playback_restriction',
    name: 'Mux playback restriction',
    description: 'Makes course video play only from the Hub, preview and local sites (plus devices that send no referrer) by adding the Mux playback restriction to the video token. Wrong settings stop video playing for whoever it covers, so turn it on for yourself first, watch videos on desktop and phone (including Safari on iPhone), then widen it. Does nothing where MUX_PLAYBACK_RESTRICTION_ID is not set',
  },
  {
    key: 'mux_data',
    name: 'Mux Data',
    description: 'Sends how well course videos play (start time, buffering, errors, with the viewer\'s IP address, browser and device, and no name, email or account id) to Mux Data, only for members who allow usage statistics. Turn it on for yourself first and check the Mux Data dashboard shows your views and errors, then widen it',
  },
];
