import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The deploy signs what it built (docs/infrastructure/DEPLOYMENT.md, "Verifying what was deployed"). The signing
// must never be able to break a deploy, must hold the only `id-token`, and every action must be pinned to a commit.

type Step = { uses?: string; "continue-on-error"?: boolean; run?: string; with?: Record<string, string> };
type Job = {
  needs?: string | string[];
  if?: string;
  "continue-on-error"?: boolean;
  permissions?: Record<string, string>;
  steps?: Step[];
  uses?: string;
};
type Workflow = { permissions?: Record<string, string>; jobs: Record<string, Job> };

function load(file: string): Workflow {
  return parse(fs.readFileSync(path.join(process.cwd(), ".github/workflows", file), "utf8")) as Workflow;
}

describe("deploy provenance", () => {
  const deploy = load("deploy.yml");
  const attest = deploy.jobs.attest;

  it("keeps the workflow read-only and the deploy job free of signing permissions", () => {
    expect(deploy.permissions).toEqual({ contents: "read" });
    expect(deploy.jobs.deploy.permissions).toEqual({ contents: "write" });
  });

  it("signs in its own job with only the permissions attestation needs", () => {
    expect(attest.permissions).toEqual({ contents: "read", "id-token": "write", attestations: "write" });
    expect(attest.needs).toBe("deploy");
  });

  it("cannot fail a deploy that went out, and only runs when one did", () => {
    expect(attest["continue-on-error"]).toBe(true);
    expect(attest.if).toContain("needs.deploy.result == 'success'");
    expect(attest.if).toContain("needs.deploy.outputs.deployed == 'true'");
    // The step that writes the manifest and SBOM, and the one that uploads them.
    const generating = (deploy.jobs.deploy.steps ?? []).filter(
      (s) => (s.run ?? "").includes("pnpm sbom") || s.with?.name === "deploy-provenance",
    );
    expect(generating).toHaveLength(2);
    for (const step of generating) expect(step["continue-on-error"]).toBe(true);
  });

  it("attests the manifest as provenance and with the SBOM", () => {
    const attestSteps = (attest.steps ?? []).filter((s) => s.uses?.startsWith("actions/attest@"));
    expect(attestSteps).toHaveLength(2);
    for (const s of attestSteps) expect(s.with?.["subject-path"]).toBe("provenance/build-output.sha256");
    expect(attestSteps.filter((s) => s.with?.["sbom-path"] === "provenance/sbom.cdx.json")).toHaveLength(1);
  });

  it("pins every action to a full commit SHA", () => {
    for (const job of Object.values(deploy.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it("is called with the permissions the attest job needs", () => {
    for (const file of ["ci.yml", "help-screenshots.yml"]) {
      const caller = Object.values(load(file).jobs).find((j) => j.uses === "./.github/workflows/deploy.yml");
      expect(caller?.permissions, file).toMatchObject({
        contents: "write",
        "id-token": "write",
        attestations: "write",
      });
    }
  });
});
