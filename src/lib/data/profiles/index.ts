import type { SeedProfile } from "../seed-profile";
import { COMMUNITY } from "./community";
import { FIRST_WEEK } from "./first-week";
import { HOSTING_HEAVY } from "./hosting-heavy";
import { LAPSING } from "./lapsing";

/**
 * Every seed profile by name. `buildDataset(PROFILES[name], now, { timeZone })` makes the in-memory
 * world; the profile's `name` is its key here, so `pnpm seed:local -- --profile <name>` can find it.
 */
export const PROFILES = {
  community: COMMUNITY,
  "first-week": FIRST_WEEK,
  lapsing: LAPSING,
  "hosting-heavy": HOSTING_HEAVY,
} satisfies Record<string, SeedProfile>;

export type ProfileName = keyof typeof PROFILES;

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

export function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(PROFILES, value);
}

export { COMMUNITY, FIRST_WEEK, HOSTING_HEAVY, LAPSING };
