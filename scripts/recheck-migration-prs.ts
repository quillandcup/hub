// After a push to main that touched supabase/migrations, finds the open pull requests whose own
// migration is no longer newer than main's latest, and makes their `Check migrations` job fail again
// so auto-merge waits until the author renumbers (`pnpm migrations:renumber`).
//
// Why: that job passed against the main the PR had when it ran, then the PR waited in CI while
// another migration merged. Re-running the job is enough: it fetches the current `main` by name
// (`git fetch origin main`, see ci.yml) and compares the PR's files with it.
//
// Run by .github/workflows/migration-recheck.yml on main's own checkout, never on PR code. It only
// reads the PRs' file names (the API), never their contents. Bare Node (24 strips types), no install:
//
//   node scripts/recheck-migration-prs.ts
//   needs GH_TOKEN, GITHUB_REPOSITORY; reads the working tree's supabase/migrations as main's.
//
// Only stale PRs are touched: a PR whose migration is still newer than main's latest passes anyway,
// so rerunning it would only cost time. A run still in progress can't have one job re-run, so it is
// cancelled first (the PR has to be renumbered and pushed anyway, which starts CI again) and the job
// is re-run once the run has stopped, so the check itself shows the usual message.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";
const CHECK_JOB_NAME = "Check migrations";
const CI_WORKFLOW = "ci.yml";
const NAME_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/;

export type OpenPr = { number: number; headSha: string; paths: string[] };
export type StalePr = { number: number; headSha: string; files: string[] };
export type Run = { id: number; status: string; createdAt: string };
export type Job = { id: number; name: string };

export function latestVersion(files: string[]): string | undefined {
  return files
    .map((file) => file.match(NAME_PATTERN)?.[1])
    .filter((version): version is string => Boolean(version))
    .sort()
    .at(-1);
}

/**
 * PRs that add a migration main doesn't have yet and whose version is at or below main's latest:
 * the ones `Check migrations` would now reject. A file main already has (the PR only edits or
 * deletes it) is not an addition. A badly named file is left to the check itself.
 */
export function findStalePrs(mainFiles: string[], prs: OpenPr[]): StalePr[] {
  const latest = latestVersion(mainFiles);
  if (!latest) return [];
  const onMain = new Set(mainFiles);
  const stale: StalePr[] = [];
  for (const pr of prs) {
    const files = pr.paths
      .filter((path) => path.startsWith(`${MIGRATIONS_DIR}/`) && path.endsWith(".sql"))
      .map((path) => path.slice(MIGRATIONS_DIR.length + 1))
      .filter((file) => !onMain.has(file))
      .filter((file) => {
        const version = file.match(NAME_PATTERN)?.[1];
        return version !== undefined && version <= latest;
      });
    if (files.length > 0) stale.push({ number: pr.number, headSha: pr.headSha, files });
  }
  return stale;
}

/** The newest CI run of the pull request event for a head commit. */
export function pickLatestRun(runs: Run[]): Run | undefined {
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function pickCheckJob(jobs: Job[]): Job | undefined {
  return jobs.find((job) => job.name === CHECK_JOB_NAME);
}

export type Api = {
  ciRuns(headSha: string): Run[];
  jobs(runId: number): Job[];
  runStatus(runId: number): string;
  cancel(runId: number): void;
  rerunJob(jobId: number): void;
  sleep(ms: number): void;
};

export type Outcome = "rerun" | "cancelled-and-rerun" | "no-run" | "no-job" | "still-running";

/** Make one stale PR's check run again; returns what happened, for the log. */
export function recheckPr(pr: StalePr, api: Api, waitMs = 10_000, maxWaits = 18): Outcome {
  const run = pickLatestRun(api.ciRuns(pr.headSha));
  if (!run) return "no-run";
  const job = pickCheckJob(api.jobs(run.id));
  if (!job) return "no-job";
  if (run.status === "completed") {
    api.rerunJob(job.id);
    return "rerun";
  }
  api.cancel(run.id);
  for (let i = 0; i < maxWaits; i++) {
    api.sleep(waitMs);
    if (api.runStatus(run.id) === "completed") {
      api.rerunJob(job.id);
      return "cancelled-and-rerun";
    }
  }
  return "still-running";
}

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function realApi(repo: string): Api {
  return {
    ciRuns: (headSha) =>
      (
        JSON.parse(
          gh("api", `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?event=pull_request&head_sha=${headSha}&per_page=20`),
        ) as { workflow_runs: { id: number; status: string; created_at: string }[] }
      ).workflow_runs.map((run) => ({ id: run.id, status: run.status, createdAt: run.created_at })),
    jobs: (runId) =>
      (
        JSON.parse(gh("api", `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)) as {
          jobs: { id: number; name: string }[];
        }
      ).jobs.map((job) => ({ id: job.id, name: job.name })),
    runStatus: (runId) => (JSON.parse(gh("api", `repos/${repo}/actions/runs/${runId}`)) as { status: string }).status,
    cancel: (runId) => {
      gh("api", "-X", "POST", `repos/${repo}/actions/runs/${runId}/cancel`);
    },
    rerunJob: (jobId) => {
      gh("api", "-X", "POST", `repos/${repo}/actions/jobs/${jobId}/rerun`);
    },
    sleep: (ms) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    },
  };
}

/** Open PRs with their file paths. The list view returns the first 100 files; fetch all for a PR that hit that. */
function listOpenPrs(repo: string): OpenPr[] {
  const prs = JSON.parse(gh("pr", "list", "--repo", repo, "--state", "open", "--limit", "300", "--json", "number,headRefOid,files")) as {
    number: number;
    headRefOid: string;
    files: { path: string }[];
  }[];
  return prs.map((pr) => {
    const paths =
      pr.files.length < 100
        ? pr.files.map((f) => f.path)
        : gh("api", "--paginate", `repos/${repo}/pulls/${pr.number}/files`, "--jq", ".[].filename").split("\n").filter(Boolean);
    return { number: pr.number, headSha: pr.headRefOid, paths };
  });
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GITHUB_REPOSITORY is not set to owner/name");
  const mainFiles = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
  const stale = findStalePrs(mainFiles, listOpenPrs(repo));
  if (stale.length === 0) {
    console.log("No open pull request has a migration that is now out of date.");
    return;
  }
  const api = realApi(repo);
  let failed = false;
  for (const pr of stale) {
    try {
      console.log(`PR #${pr.number} (${pr.files.join(", ")}): ${recheckPr(pr, api)}`);
    } catch (error) {
      failed = true;
      console.error(`PR #${pr.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1]?.endsWith("recheck-migration-prs.ts")) main();
