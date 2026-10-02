// Where env var values live, shared by the sync scripts (see env-vars.config.ts):
//   .env.shared   same in every environment -- the base for every target
//   .env.preview  Vercel Preview overrides
//   .env.prod     Vercel Production overrides, plus CI/ops credentials (GitHub, Vault)

import { existsSync, readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";
import type { VercelTarget } from "../env-vars.config";

export const SHARED_FILE = ".env.shared";
export const TARGET_FILE: Record<VercelTarget, string> = {
  preview: ".env.preview",
  production: ".env.prod",
};

function load(path: string): Record<string, string> {
  if (!existsSync(path)) {
    console.error(`✗ ${path} not found`);
    process.exit(1);
  }
  return parseDotenv(readFileSync(path));
}

/**
 * The values a target gets: .env.shared, overridden by the target's own file. Empty strings
 * count as unset, so an empty override doesn't hide the shared value.
 */
export function loadTargetEnv(target: VercelTarget): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of [SHARED_FILE, TARGET_FILE[target]]) {
    for (const [k, v] of Object.entries(load(file))) if (v !== "") merged[k] = v;
  }
  return merged;
}

/** Human-readable "where should this be" for a missing value. */
export function sourceFilesFor(target: VercelTarget): string {
  return `${TARGET_FILE[target]} or ${SHARED_FILE}`;
}
