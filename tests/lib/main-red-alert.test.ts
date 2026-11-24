import { describe, expect, it } from "vitest";
import {
  type Action,
  type Api,
  apply,
  decide,
  failedJobNames,
  ISSUE_TITLE,
  issueBody,
  type OpenIssue,
  PROOF_JOB,
  type RunInfo,
  runFromEnv,
} from "@/scripts/main-red-alert";

const sha = "a".repeat(40);
const run: RunInfo = {
  id: "123",
  conclusion: "failure",
  event: "push",
  sha,
  url: "https://github.com/example-org/example-repo/actions/runs/123",
};
const jobs = [
  { name: "Check migrations", conclusion: "failure" },
  { name: "Test (unit)", conclusion: "success" },
  { name: "Push migrations to production", conclusion: "skipped" },
  { name: "Coverage report", conclusion: "cancelled" },
  { name: "Slow `job`\nname", conclusion: "timed_out" },
];

describe("failedJobNames", () => {
  it("keeps failed and timed out jobs only, and strips markdown-breaking characters", () => {
    expect(failedJobNames(jobs)).toEqual(["Check migrations", "Slow  job  name"]);
  });
});

describe("decide", () => {
  it("reports a failure with its failed jobs", () => {
    expect(decide(run, jobs)).toEqual({ kind: "report", failed: ["Check migrations", "Slow  job  name"] });
  });

  it("ignores a cancelled run", () => {
    expect(decide({ ...run, conclusion: "cancelled" }, jobs).kind).toBe("none");
  });

  it("closes on a success whose unit tests ran", () => {
    expect(decide({ ...run, conclusion: "success" }, jobs)).toEqual({ kind: "close" });
  });

  it("does not close on a docs-only success where the tests were skipped", () => {
    const skipped = [{ name: PROOF_JOB, conclusion: "skipped" }];
    expect(decide({ ...run, conclusion: "success" }, skipped).kind).toBe("none");
    expect(decide({ ...run, conclusion: "success" }, []).kind).toBe("none");
  });

  it("ignores runs that are not pushes to main, such as a pull request", () => {
    expect(decide({ ...run, event: "pull_request" }, jobs).kind).toBe("none");
    expect(decide({ ...run, event: "workflow_dispatch" }, jobs).kind).toBe("report");
  });
});

describe("issueBody", () => {
  it("names the commit, the failed jobs and the run, and nothing else", () => {
    const body = issueBody(run, ["Check migrations"]);
    expect(body).toContain(sha);
    expect(body).toContain("- Check migrations");
    expect(body).toContain(run.url);
  });

  it("copes with no single failed job", () => {
    expect(issueBody(run, [])).toContain("no single failed job");
  });
});

describe("apply", () => {
  function fake(open?: OpenIssue) {
    const calls: string[] = [];
    const api: Api = {
      openIssue: () => open,
      createIssue: (title) => calls.push(`create ${title}`),
      editIssue: (n) => calls.push(`edit ${n}`),
      comment: (n, body) => calls.push(`comment ${n} ${body.includes(sha)}`),
      closeIssue: (n) => calls.push(`close ${n}`),
    };
    return { api, calls };
  }
  const report: Action = { kind: "report", failed: ["Check migrations"] };

  it("opens one issue when none is open", () => {
    const { api, calls } = fake();
    apply(run, report, api);
    expect(calls).toEqual([`create ${ISSUE_TITLE}`]);
  });

  it("updates the open issue instead of opening a second, and comments about the new commit", () => {
    const { api, calls } = fake({ number: 5, body: "older run https://github.com/example-org/example-repo/actions/runs/99" });
    apply(run, report, api);
    expect(calls).toEqual(["edit 5", "comment 5 true"]);
  });

  it("does nothing when the open issue already reports this run", () => {
    const { api, calls } = fake({ number: 5, body: `Run: ${run.url}` });
    apply(run, report, api);
    expect(calls).toEqual([]);
  });

  it("closes the open issue on a pass, and does nothing when none is open", () => {
    const withIssue = fake({ number: 5, body: "" });
    apply(run, { kind: "close" }, withIssue.api);
    expect(withIssue.calls).toEqual(["close 5"]);
    const without = fake();
    apply(run, { kind: "close" }, without.api);
    expect(without.calls).toEqual([]);
  });

  it("does not touch anything for a no-op decision", () => {
    const { api, calls } = fake({ number: 5, body: "" });
    expect(apply(run, { kind: "none", reason: "cancelled" }, api)).toContain("cancelled");
    expect(calls).toEqual([]);
  });
});

describe("runFromEnv", () => {
  const env = {
    GITHUB_REPOSITORY: "example-org/example-repo",
    RUN_ID: "123",
    RUN_CONCLUSION: "failure",
    RUN_EVENT: "push",
    RUN_SHA: sha,
    RUN_URL: run.url,
  };

  it("accepts a well-formed event", () => {
    expect(runFromEnv(env).run.id).toBe("123");
  });

  it("rejects values that are not what they should be", () => {
    expect(() => runFromEnv({ ...env, RUN_ID: "1; rm" })).toThrow();
    expect(() => runFromEnv({ ...env, RUN_SHA: "main" })).toThrow();
    expect(() => runFromEnv({ ...env, GITHUB_REPOSITORY: "no-slash" })).toThrow();
    expect(() => runFromEnv({ ...env, RUN_URL: "https://example.com/actions/runs/123" })).toThrow();
  });
});
