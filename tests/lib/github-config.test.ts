import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { workflowPermissionsDiff } from "../../scripts/github-config";

const config = parseYaml(readFileSync("config/github.yml", "utf8")) as {
  workflow_permissions: Record<string, boolean | string>;
};

describe("config/github.yml workflow_permissions", () => {
  it("declares a read-only default token and keeps workflows able to approve PRs", () => {
    expect(config.workflow_permissions).toEqual({
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: true,
    });
  });
});

describe("workflowPermissionsDiff", () => {
  const want = config.workflow_permissions;

  it("is empty when the live settings match", () => {
    expect(workflowPermissionsDiff({ ...want }, want)).toEqual([]);
  });

  it("shows a drifted default permission", () => {
    expect(workflowPermissionsDiff({ ...want, default_workflow_permissions: "write" }, want)).toEqual([
      '~ default_workflow_permissions: "write" -> "read"',
    ]);
  });

  it("shows a changed approval flag and ignores keys the file does not declare", () => {
    const live = { ...want, can_approve_pull_request_reviews: false, extra: 1 };
    expect(workflowPermissionsDiff(live, want)).toEqual(["~ can_approve_pull_request_reviews: false -> true"]);
  });
});
