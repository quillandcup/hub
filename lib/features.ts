export type FeatureKey = 'streaks' | 'member_overrides' | 'prickle_picker' | 'wheel_of_wonder' | 'hedgieversaries' | 'work_queue' | 'program_cohorts' | 'events';

export interface FeaturePreview {
  key: FeatureKey;
  name: string;
  description: string;
}

export const FEATURE_PREVIEWS: FeaturePreview[] = [
  {
    key: 'streaks',
    name: 'Streaks',
    description: 'Track your writing streaks over time',
  },
  {
    key: 'member_overrides',
    name: 'Member Overrides',
    description: 'Suppress reconciliation mismatches (180 program, hiatus, gifted memberships)',
  },
  {
    key: 'prickle_picker',
    name: 'Prickle Picker',
    description: 'A wizard that recommends upcoming prickles based on mood, purpose, and who you want to see',
  },
  {
    key: 'wheel_of_wonder',
    name: 'Wheel of Wonder',
    description: 'Spin to get matched with a hedgie who’s online in Slack right now',
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
];

