// Reads skewProtection.maxAgeSeconds from vercel-project-config.yml. Shared by scripts/vercel-config.ts (which
// applies it to the Vercel project) and next.config.ts (which gives the page the same number, so the app can warn a
// tab before the deployment it came from stops being served). Node only: never import it from app code.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export const PROJECT_CONFIG_FILE = "vercel-project-config.yml";

/** Vercel keeps production deployments for 30 days at most (Deployment Retention); the max age can't exceed that. */
const MAX_AGE_LIMIT_SECONDS = 30 * 24 * 60 * 60;
const MIN_AGE_SECONDS = 60 * 60;

/** `skewProtection.maxAgeSeconds` of the parsed file; throws a message naming the file when it isn't a sensible number of seconds. */
export function skewMaxAgeSeconds(raw: unknown): number {
  const value = (raw as { skewProtection?: { maxAgeSeconds?: unknown } } | null)?.skewProtection?.maxAgeSeconds;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_AGE_SECONDS || value > MAX_AGE_LIMIT_SECONDS) {
    throw new Error(`${PROJECT_CONFIG_FILE}: skewProtection.maxAgeSeconds must be a whole number of seconds from ${MIN_AGE_SECONDS} (1 hour) to ${MAX_AGE_LIMIT_SECONDS} (30 days)`);
  }
  return value;
}

export function readSkewMaxAgeSeconds(file = PROJECT_CONFIG_FILE): number {
  return skewMaxAgeSeconds(parseYaml(readFileSync(file, "utf8")));
}
