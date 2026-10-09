export type FeatureKey = 'member_overrides' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'events' | 'message_privacy' | 'slack_admin_sign_in' | 'onboarding' | 'in_app_notifications' | 'chat';

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
    key: 'onboarding',
    name: 'Getting Started Tour',
    description: 'A guided tour that walks members page to page through setting up their names, profile, a writing goal and their first prickle (and, for hosts, their hosting schedule and vibe). Starts on its own for accounts under 30 days old; anyone can start it from the user menu',
  },
  {
    key: 'in_app_notifications',
    name: 'In-App Notifications',
    description: 'Notifications in the Hub, next to Slack: a bell in the header with the latest, an inbox page with all of them, and a banner while one is time-sensitive (a check-in until the prickle starts, a check-out for a few hours after it ends). Adds an "In the Hub" switch to Settings → Notifications (on by default)',
  },
  {
    key: 'chat',
    name: 'Chat',
    description: 'A read-only Hub view of our Slack channels: channel list, messages with threads and reactions. Only the channels you are in, plus public ones. Posting from the Hub comes later',
  },
];
