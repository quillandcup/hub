// Loads an env file the way the sync scripts see it (scripts/env-files.ts): the `.env.shared` next to it is the
// base, and the file itself overrides it, so `--env .env.prod` also gets what only lives in `.env.shared` (the
// Kajabi site id, say). Empty values count as unset, so an empty override doesn't hide the shared value, and a
// variable already in the process environment is never replaced.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "dotenv";

export const SHARED_ENV_FILE = ".env.shared";

export interface LayeredEnv {
  /** The values read, shared first and the file over it, empty ones left out. */
  values: Record<string, string>;
  /** The files that were read, for the message when something is missing. */
  files: string[];
}

/** Reads the file and its sibling `.env.shared`. Throws when the file itself is missing. */
export function readLayeredEnv(file: string): LayeredEnv {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`${file} not found`);
  const shared = join(dirname(path), SHARED_ENV_FILE);
  const files = basename(path) !== SHARED_ENV_FILE && existsSync(shared) ? [shared, path] : [path];
  const values: Record<string, string> = {};
  for (const f of files) for (const [k, v] of Object.entries(parse(readFileSync(f)))) if (v !== "") values[k] = v;
  return { values, files };
}

/** Puts the layered values into `process.env`, leaving anything already set alone. */
export function loadLayeredEnv(file: string, env: Record<string, string | undefined> = process.env): LayeredEnv {
  const layered = readLayeredEnv(file);
  for (const [k, v] of Object.entries(layered.values)) if (env[k] === undefined) env[k] = v;
  return layered;
}
