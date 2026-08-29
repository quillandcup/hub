export type FeatureKey = 'streaks' | 'hiatus_tracking' | 'member_overrides' | 'prickle_picker' | 'wheel_of_wonder' | 'hedgieversaries';

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
    key: 'hiatus_tracking',
    name: 'Hiatus Tracking',
    description: 'Track and manage member hiatus periods',
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
];

