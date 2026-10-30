export type FeatureKey = 'member_overrides' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'events' | 'slack_admin_sign_in' | 'browser_notifications' | 'chat' | 'chat_posting' | 'big_sisters' | 'intro_reminders' | 'prickle_reminders' | 'courses' | 'hosting';

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
  {
    key: 'intro_reminders',
    name: 'Send intro reminders',
    description: 'Sends the hourly reminder to say hello in #start-here for real to the members this covers: everyone when switched on globally, otherwise only members in a linked segment or with their own preview. For everyone else the job only logs who it would have reminded and why (see the logs of /api/internal/member-reminders). Members still choose their channels in Settings → Notifications',
  },
  {
    key: 'prickle_reminders',
    name: 'Send prickle reminders',
    description: 'Sends the reminder to put a prickle on your calendar (it backs off the longer it goes unanswered) for real to the members this covers: everyone when switched on globally, otherwise only members in a linked segment or with their own preview. For everyone else the job only logs who it would have reminded and why. Members also have to turn the reminders on themselves in Settings → Notifications, as they are off until then',
  },
  {
    key: 'courses',
    name: 'Courses',
    description: 'Courses in the Hub (The Ready Writer first): a Courses page with progress, the course outline, and lesson pages with video, text and mark-complete. Members see only the courses they have access to; staff see all of them. Keep off until launch day',
  },
  {
    key: 'hosting',
    name: 'Hosting',
    description: 'Hosting for members: the Hosting tab in My Prickles (stats, monthly slot requests), the host vibe settings, and the hosting steps of the Getting started tour. Hidden until the change of process is agreed with the staff who run it; staff-side host tools are unaffected',
  },
];
