import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compare, parseResults, summarize, type Baseline, type ControlResult } from "@/scripts/pvtr-scan";

const results = (entries: Record<string, string>): Map<string, ControlResult> =>
  new Map(Object.entries(entries).map(([id, result]) => [id, { result, message: `${id} says ${result}` }]));

const scanJson = (logs: Array<[string, string]>) => ({
  "evaluation-suites": [
    {
      "control-evaluations": {
        evaluations: [
          {
            "assessment-logs": logs.map(([id, result]) => ({ requirement: { "entry-id": id }, result, message: " spaced\n out " })),
          },
        ],
      },
    },
  ],
});

const TODAY = "2026-11-24";
const baseline: Baseline = {
  controls: {
    "OSPS-A-01.01": { result: "Passed" },
    "OSPS-A-02.01": { result: "Failed", reason: "known", expires: "2027-01-01" },
    "OSPS-A-03.01": { result: "Not Applicable", reason: "no releases", expires: "2027-01-01" },
    "OSPS-A-04.01": { result: ["Passed", "Needs Review"], reason: "token scope", expires: "2027-01-01" },
  },
};

describe("compare", () => {
  it("is quiet when every control is as expected, and an unlisted control is expected to pass", () => {
    const c = compare(
      baseline,
      results({ "OSPS-A-01.01": "Passed", "OSPS-A-02.01": "Failed", "OSPS-A-03.01": "Not Applicable", "OSPS-A-04.01": "Needs Review", "OSPS-X-01.01": "Passed" }),
      TODAY,
    );
    expect(c).toMatchObject({ worse: [], improved: [], expired: [], missing: [], total: 5 });
  });

  it("flags Passed to anything else, N/A to Failed and Needs Review to Failed", () => {
    const c = compare(
      baseline,
      results({ "OSPS-A-01.01": "Needs Review", "OSPS-A-03.01": "Failed", "OSPS-A-04.01": "Failed", "OSPS-A-02.01": "Failed" }),
      TODAY,
    );
    expect(c.worse.map((w) => w.id)).toEqual(["OSPS-A-01.01", "OSPS-A-03.01", "OSPS-A-04.01"]);
    expect(c.improved).toEqual([]);
  });

  it("treats Passed to Not Applicable as worse, so a control that stops applying is noticed", () => {
    expect(compare(baseline, results({ "OSPS-A-01.01": "Not Applicable" }), TODAY).worse).toHaveLength(1);
  });

  it("flags a new control that does not pass, and ignores a new one that passes", () => {
    const c = compare(baseline, results({ "OSPS-N-01.01": "Failed", "OSPS-N-02.01": "Passed" }), TODAY);
    expect(c.worse.map((w) => w.id)).toEqual(["OSPS-N-01.01"]);
  });

  it("lists an improvement without failing, and a flip inside an accepted set is not a change", () => {
    const c = compare(baseline, results({ "OSPS-A-02.01": "Passed", "OSPS-A-03.01": "Passed", "OSPS-A-04.01": "Passed" }), TODAY);
    expect(c.improved.map((i) => i.id)).toEqual(["OSPS-A-02.01", "OSPS-A-03.01"]);
    expect(c.worse).toEqual([]);
    expect(c.expired).toEqual([]);
  });

  it("treats a result word it does not know as the worst", () => {
    expect(compare(baseline, results({ "OSPS-A-01.01": "Mystery" }), TODAY).worse).toHaveLength(1);
  });

  it("flags an expired entry, one valid through its last day, and one without a reason or a date", () => {
    const c = compare(
      {
        controls: {
          "OSPS-E-01.01": { result: "Failed", reason: "r", expires: "2026-11-23" },
          "OSPS-E-02.01": { result: "Failed", reason: "r", expires: TODAY },
          "OSPS-E-03.01": { result: "Failed", expires: "2027-01-01" },
          "OSPS-E-04.01": { result: "Failed", reason: "r" },
          "OSPS-E-05.01": { result: "Passed" },
        },
      },
      results({ "OSPS-E-01.01": "Failed", "OSPS-E-02.01": "Failed", "OSPS-E-03.01": "Failed", "OSPS-E-04.01": "Failed", "OSPS-E-05.01": "Passed" }),
      TODAY,
    );
    expect(c.expired.map((e) => `${e.id}: ${e.problem}`)).toEqual([
      "OSPS-E-01.01: expired 2026-11-23",
      "OSPS-E-03.01: has no reason",
      "OSPS-E-04.01: has no expiry date",
    ]);
  });

  it("notes baseline entries the scan did not report", () => {
    expect(compare(baseline, results({ "OSPS-A-01.01": "Passed" }), TODAY).missing).toEqual(["OSPS-A-02.01", "OSPS-A-03.01", "OSPS-A-04.01"]);
  });
});

describe("parseResults", () => {
  it("reads control ids and results and keeps the worse of a repeated control", () => {
    const parsed = parseResults(scanJson([["OSPS-A-01.01", "Passed"], ["OSPS-A-01.01", "Failed"], ["OSPS-A-02.01", "Passed"]]));
    expect(parsed.get("OSPS-A-01.01")).toEqual({ result: "Failed", message: "spaced out" });
    expect(parsed.size).toBe(2);
  });

  it("throws on a file that is not scanner output or holds no controls", () => {
    expect(() => parseResults({})).toThrow(/evaluation-suites/);
    expect(() => parseResults(scanJson([]))).toThrow(/no controls/);
  });
});

describe("summarize", () => {
  it("is short when nothing changed and points to the baseline when something improved", () => {
    expect(summarize(compare(baseline, results({ "OSPS-A-01.01": "Passed" }), TODAY))).toContain("Every control is as the baseline expects.");
    const better = summarize(compare(baseline, results({ "OSPS-A-02.01": "Passed" }), TODAY));
    expect(better).toContain("update config/pvtr-baseline.json");
    expect(better).not.toContain("Worse than the baseline");
  });

  it("lists what got worse with the scanner's message, without breaking the table", () => {
    const text = summarize(compare(baseline, new Map([["OSPS-A-01.01", { result: "Failed", message: "a | b" }]]), TODAY));
    expect(text).toContain("| OSPS-A-01.01 | Passed | Failed | a / b |");
  });
});

describe("the pinned scanner", () => {
  const pinned = JSON.parse(readFileSync("config/pvtr-scanner.json", "utf8")) as Record<string, unknown>;
  it("names a version, an asset and a sha256", () => {
    expect(pinned.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(pinned.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pinned.asset).toMatch(/Linux_x86_64\.tar\.gz$/);
    expect(pinned.repository).toBe("ossf/pvtr-github-repo-scanner");
  });
});
