import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// `checkly deploy` prints every heartbeat's ping URL, and anyone holding one can fake a healthy run.
// The CI logs are public, so the deploy step has to redact the URLs it prints.

type Step = { run?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

describe("checkly deploy log redaction", () => {
  it("pipes the deploy output through a redaction of the ping URLs", () => {
    const wf = parse(fs.readFileSync(path.join(process.cwd(), ".github/workflows/checkly.yml"), "utf8")) as Workflow;
    const deploy = (wf.jobs?.["checkly-deploy"]?.steps ?? []).find((s) => (s.run ?? "").includes("checkly deploy"));
    expect(deploy?.run).toMatch(/checkly deploy[^|]*\|\s*sed .*ping\\\.checklyhq\\\.com/);
  });
});
