export type FeatureKey = 'streaks' | 'hiatus_tracking' | 'member_overrides';

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
];

