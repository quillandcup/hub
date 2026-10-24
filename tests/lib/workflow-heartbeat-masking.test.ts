import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// CHECKLY_HEARTBEAT_* values are ping URLs: anyone holding one can fake a healthy run, so a
// workflow step that uses one must register it with ::add-mask:: first (before it can be logged).

type Step = { run?: string; env?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const PREFIX = "CHECKLY_HEARTBEAT_";

function names(value: unknown): string[] {
  return [...new Set(JSON.stringify(value ?? "").match(/CHECKLY_HEARTBEAT_[A-Z0-9_]+/g) ?? [])];
}

/** Heartbeat variables used by a step that neither it nor an earlier step masks. */
function unmaskedHeartbeats(steps: Step[]): string[] {
  const missing: string[] = [];
  steps.forEach((step, i) => {
    for (const name of names(step)) {
      const masked = steps
        .slice(0, i + 1)
        .some((s) => (s.run ?? "").split("\n").some((l) => l.includes("::add-mask::") && l.includes(name)));
      if (!masked) missing.push(`${name} (step ${i + 1})`);
    }
  });
  return missing;
}

describe("workflow steps masking CHECKLY_HEARTBEAT_* values", () => {
  const dir = path.join(process.cwd(), ".github/workflows");
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    it(`${file} masks every heartbeat URL it uses`, () => {
      const wf = parse(fs.readFileSync(path.join(dir, file), "utf8")) as Workflow;
      for (const [job, def] of Object.entries(wf.jobs ?? {})) {
        expect(unmaskedHeartbeats(def.steps ?? []), `${file} job ${job}`).toEqual([]);
      }
    });
  }

  it("flags a step that uses a heartbeat without masking it", () => {
    const env = { [`${PREFIX}X`]: "${{ secrets.CHECKLY_HEARTBEAT_X }}" };
    expect(unmaskedHeartbeats([{ run: "curl x", env }])).toEqual([`${PREFIX}X (step 1)`]);
  });

  it("accepts a mask that tolerates an empty value", () => {
    const env = { [`${PREFIX}X`]: "${{ secrets.CHECKLY_HEARTBEAT_X }}" };
    const run = `if [ -n "$${PREFIX}X" ]; then echo "::add-mask::$${PREFIX}X"; fi\ncurl x`;
    expect(unmaskedHeartbeats([{ run, env }])).toEqual([]);
  });
});

describe("checkly deploy log redaction", () => {
  it("pipes the deploy output through a redaction of the ping URLs", () => {
    const wf = parse(fs.readFileSync(path.join(process.cwd(), ".github/workflows/checkly.yml"), "utf8")) as Workflow;
    const deploy = (wf.jobs?.["checkly-deploy"]?.steps ?? []).find((s) => (s.run ?? "").includes("checkly deploy"));
    expect(deploy?.run).toMatch(/checkly deploy[^|]*\|\s*sed .*ping\\\.checklyhq\\\.com/);
  });
});
