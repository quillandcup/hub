import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { SET_ID, contentId, pickSet } from "./help-images-version";

/**
 * CI's questions about the published help screenshot sets (docs/DEMO_AND_HELP.md), answered from the bucket and git
 * history. Needs full history (`fetch-depth: 0`) and NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY of the
 * project the sets are published to.
 *
 *   pick     the set HEAD shows: the newest published set whose commit is an ancestor of HEAD. Written to
 *            $GITHUB_ENV as HELP_IMAGES_VERSION for the build that follows. With no set, a warning and nothing
 *            written (the build then shows no images rather than the deploy failing).
 *   needed   whether HEAD's screens differ from that set's: writes `needed=true|false` to $GITHUB_OUTPUT.
 *            True when there is no set yet.
 */

const BUCKET = "help-images";

/** The set folders in the bucket: the entries with no id are folders. */
export async function listSets(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`listing the help-images bucket failed: HTTP ${res.status}`);
  const entries = (await res.json()) as { name: string; id: string | null }[];
  return entries.filter((e) => !e.id && SET_ID.test(e.name)).map((e) => e.name);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** The full sha a set id (twelve characters) names, or null when it isn't a commit here. */
function shaOf(set: string): string | null {
  try {
    return git("rev-parse", "--verify", "--quiet", `${set}^{commit}`);
  } catch {
    return null;
  }
}

function setOutput(file: string | undefined, line: string) {
  if (file) appendFileSync(file, `${line}\n`);
  else console.log(line);
}

async function main() {
  const [command] = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

  const sets = await listSets(url, key);
  const picked = pickSet(sets, git("rev-list", "HEAD").split("\n"));

  if (command === "pick") {
    if (!picked) {
      console.log(`::warning::No published help screenshot set is an ancestor of HEAD (${sets.length} sets exist); the build will show no help images.`);
      return;
    }
    console.log(`Help screenshots: set ${picked}`);
    setOutput(process.env.GITHUB_ENV, `HELP_IMAGES_VERSION=${picked}`);
  } else if (command === "needed") {
    const sha = picked ? shaOf(picked) : null;
    const needed = !sha || contentId(sha) !== contentId("HEAD");
    console.log(picked ? `Newest set ${picked}; screens ${needed ? "changed" : "unchanged"} since.` : "No set published yet.");
    setOutput(process.env.GITHUB_OUTPUT, `needed=${needed}`);
  } else {
    throw new Error("usage: help-images-sets.ts pick|needed");
  }
}

if (process.argv[1]?.endsWith("help-images-sets.ts")) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
