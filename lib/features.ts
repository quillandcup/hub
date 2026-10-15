export type FeatureKey = 'member_overrides' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'events' | 'message_privacy' | 'slack_admin_sign_in' |'in_app_notifications' | 'browser_notifications' | 'chat' | 'chat_posting' | 'big_sisters';

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
    key: 'events',
    name: 'Events',
    description: 'Retreats and other events, with metadata and a photo gallery imported from Google Photos',
  },
  {
    key: 'message_privacy',
    name: 'Message Privacy Page',
    description: 'Member-facing /privacy page explaining what staff can see in Slack and Hub chat. Describes the planned chat bridge; keep off until that ships',
  },
  {
    key: 'slack_admin_sign_in',
    name: 'Slack Sign-In for Admins',
    description: 'Lets you sign in to your admin account from Billie Bot (/hub or its Home tab), with links that last 10 minutes. Anyone who can use your Slack can then get into the Hub as you. Only your own opt-in counts: the global switch and segments do not turn this on',
  },
  {
    key: 'in_app_notifications',
    name: 'In-App Notifications',
    description: 'Notifications in the Hub, next to Slack: a bell in the header with the latest, an inbox page with all of them, and a banner while one is time-sensitive (a check-in until the prickle starts, a check-out for a few hours after it ends). Adds an "In the Hub" switch to Settings → Notifications (on by default)',
  },
  {
    key: 'browser_notifications',
    name: 'Browser Notifications',
    description: 'Desktop and phone notifications from your browser, even when the Hub is closed (Web Push). Adds a "Browser" switch and a per-device "Turn on for this device" button to Settings → Notifications; a device only receives them once it has turned them on',
  },
  {
    key: 'chat',
    name: 'Chat',
    description: 'A read-only Hub view of our Slack channels: channel list, messages with threads and reactions. Only the channels you are in, plus public ones. Posting from the Hub comes later',
  },
  {
    key: 'chat_posting',
    name: 'Chat posting',
    description: 'Write messages and thread replies in Hub chat; they appear in Slack too, posted by Billie Bot under your name and photo. Needs Chat',
  },
  {
    key: 'big_sisters',
    name: 'Big Sisters',
    description: 'Every new member gets a big sister for their first 30 days: matching, volunteers and effectiveness for staff, plus a Big Sisters card on the dashboard, a Big Sisters page, an introduction message and a Getting Started step for members. Staff also need the Admin Work Queue to see who is waiting for a match',
  },
];
