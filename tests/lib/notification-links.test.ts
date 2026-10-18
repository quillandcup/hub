import { describe, it, expect } from "vitest";
import { SLACK_WORKSPACE_URL } from "@/lib/config";
import { externalLinkProps, isAllowedExternalUrl } from "@/lib/notification-links";

describe("notification links", () => {
  it("allows only the Slack workspace off-site", () => {
    expect(isAllowedExternalUrl(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C1`)).toBe(true);
    expect(isAllowedExternalUrl(SLACK_WORKSPACE_URL)).toBe(true);
    expect(isAllowedExternalUrl(`${SLACK_WORKSPACE_URL}.evil.example`)).toBe(false);
    expect(isAllowedExternalUrl("https://example.com")).toBe(false);
  });

  it("opens external links in a new tab and Hub paths in place", () => {
    expect(externalLinkProps(`${SLACK_WORKSPACE_URL}/x`)).toEqual({ target: "_blank", rel: "noopener noreferrer" });
    expect(externalLinkProps("/prickles/p1")).toEqual({});
  });
});
