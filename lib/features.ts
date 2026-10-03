export type FeatureKey = 'member_overrides' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'events' | 'message_privacy' | 'slack_admin_sign_in';

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
];

