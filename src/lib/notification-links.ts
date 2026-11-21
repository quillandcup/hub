import { SLACK_WORKSPACE_URL } from "@/lib/config";

/**
 * Off-site links a notification may carry. Hub paths always work; of everything else only the
 * Slack workspace does, since a notification row's URL comes from server code but is shown as a
 * link in every member's bell, so it must never point at an arbitrary site.
 */
export function isAllowedExternalUrl(url: string): boolean {
  return url === SLACK_WORKSPACE_URL || url.startsWith(`${SLACK_WORKSPACE_URL}/`) || url.startsWith(`${SLACK_WORKSPACE_URL}?`);
}

/** A stored notification URL is a Hub path or an allowed external link; only the latter opens in a new tab. */
export function isExternalLink(url: string): boolean {
  return !url.startsWith("/");
}

export function externalLinkProps(url: string): { target?: string; rel?: string } {
  return isExternalLink(url) ? { target: "_blank", rel: "noopener noreferrer" } : {};
}
