import { describe, expect, it } from "vitest";
import {
  type Api,
  findStalePrs,
  latestVersion,
  pickCheckJob,
  pickLatestRun,
  recheckPr,
  type StalePr,
} from "@/scripts/recheck-migration-prs";

const main = ["20261101000000_a.sql", "20261120000000_b.sql", "README.md"];
const dir = "supabase/migrations/";

describe("latestVersion", () => {
  it("finds the newest version and ignores other files", () => {
    expect(latestVersion(main)).toBe("20261120000000");
    expect(latestVersion([])).toBeUndefined();
  });
});

describe("findStalePrs", () => {
  it("flags a PR whose migration is not newer than main's latest", () => {
    const prs = [{ number: 7, headSha: "abc", paths: [`${dir}20261119000000_late.sql`, "src/x.ts"] }];
    expect(findStalePrs(main, prs)).toEqual([{ number: 7, headSha: "abc", files: ["20261119000000_late.sql"] }]);
  });

  it("flags the same version as main's latest, under another name", () => {
    const prs = [{ number: 7, headSha: "abc", paths: [`${dir}20261120000000_other.sql`] }];
    expect(findStalePrs(main, prs)).toHaveLength(1);
  });

  it("leaves a PR with a newer migration, or none, alone", () => {
    const prs = [
      { number: 1, headSha: "a", paths: [`${dir}20261121000000_new.sql`] },
      { number: 2, headSha: "b", paths: ["src/x.ts", "docs/TODO.md"] },
    ];
    expect(findStalePrs(main, prs)).toEqual([]);
  });

  it("does not count a migration main already has (the PR only edits or deletes it)", () => {
    const prs = [{ number: 3, headSha: "c", paths: [`${dir}20261101000000_a.sql`] }];
    expect(findStalePrs(main, prs)).toEqual([]);
  });

  it("ignores badly named files, which the check itself reports, and non-sql files", () => {
    const prs = [{ number: 4, headSha: "d", paths: [`${dir}notes.sql`, `${dir}20261101000000_x.txt`, "supabase/other/20261101000000_x.sql"] }];
    expect(findStalePrs(main, prs)).toEqual([]);
  });

  it("returns nothing when main has no migrations", () => {
    expect(findStalePrs([], [{ number: 1, headSha: "a", paths: [`${dir}20261101000000_x.sql`] }])).toEqual([]);
  });
});

describe("pickers", () => {
  it("picks the newest run and the Check migrations job", () => {
    expect(
      pickLatestRun([
        { id: 1, status: "completed", createdAt: "2026-11-23T10:00:00Z" },
        { id: 2, status: "in_progress", createdAt: "2026-11-23T11:00:00Z" },
      ])?.id,
    ).toBe(2);
    expect(pickLatestRun([])).toBeUndefined();
    expect(pickCheckJob([{ id: 5, name: "Test (unit)" }, { id: 6, name: "Check migrations" }])?.id).toBe(6);
    expect(pickCheckJob([{ id: 5, name: "Test (unit)" }])).toBeUndefined();
  });
});

describe("recheckPr", () => {
  const pr: StalePr = { number: 9, headSha: "sha9", files: ["20261119000000_late.sql"] };

  function fakeApi(over: Partial<{ status: string; statuses: string[]; runs: number; job: boolean }> = {}) {
    const calls: string[] = [];
    const statuses = [...(over.statuses ?? [])];
    const api: Api = {
      ciRuns: (sha) => {
        calls.push(`runs ${sha}`);
        return over.runs === 0 ? [] : [{ id: 100, status: over.status ?? "completed", createdAt: "2026-11-23T10:00:00Z" }];
      },
      jobs: () => (over.job === false ? [{ id: 1, name: "Test (unit)" }] : [{ id: 1, name: "Test (unit)" }, { id: 2, name: "Check migrations" }]),
      runStatus: () => statuses.shift() ?? "completed",
      cancel: (id) => calls.push(`cancel ${id}`),
      rerunJob: (id) => calls.push(`rerun ${id}`),
      sleep: () => calls.push("sleep"),
    };
    return { api, calls };
  }

  it("re-runs only the Check migrations job of a finished run", () => {
    const { api, calls } = fakeApi();
    expect(recheckPr(pr, api)).toBe("rerun");
    expect(calls).toEqual(["runs sha9", "rerun 2"]);
  });

  it("cancels a run in progress, waits for it to stop, then re-runs the job", () => {
    const { api, calls } = fakeApi({ status: "in_progress", statuses: ["in_progress", "completed"] });
    expect(recheckPr(pr, api, 1)).toBe("cancelled-and-rerun");
    expect(calls).toEqual(["runs sha9", "cancel 100", "sleep", "sleep", "rerun 2"]);
  });

  it("gives up without re-running when the run never stops", () => {
    const { api, calls } = fakeApi({ status: "in_progress", statuses: Array(5).fill("in_progress") });
    expect(recheckPr(pr, api, 1, 3)).toBe("still-running");
    expect(calls.filter((c) => c.startsWith("rerun"))).toEqual([]);
  });

  it("does nothing when the PR has no CI run or no such job", () => {
    expect(recheckPr(pr, fakeApi({ runs: 0 }).api)).toBe("no-run");
    expect(recheckPr(pr, fakeApi({ job: false }).api)).toBe("no-job");
  });
});
