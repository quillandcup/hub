import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMessage = vi.hoisted(() => vi.fn(async (message: { channel: string; text: string }) => { void message; }));
const sendEmail = vi.hoisted(() => vi.fn(async () => {}));
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@slack/web-api", () => ({ WebClient: class { chat = { postMessage }; } }));
vi.mock("@/lib/config", () => ({ isProduction: true, SLACK_ALERTS_CHANNEL_ID: "C0CA91G8LGH" }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import appConfig from "../../app.config";
import { createInMemoryRepos } from "@/lib/data/repos";
import { sendOperationsAlert, sentrySectionSearchUrl } from "@/lib/operations-alerts";

/** Repositories whose rate limiter lets every alert through, with the call to check. */
function allowing() {
  const repos = createInMemoryRepos();
  const hit = vi.spyOn(repos.rateLimit, "hit").mockResolvedValue(true);
  return { repos, hit };
}

const failedDm = { type: "slack_dm_failed" as const, notificationKind: "prickle_checkin", memberId: "m1" };

beforeEach(() => {
  postMessage.mockReset();
  sendEmail.mockReset();
  captureException.mockClear();
  vi.stubEnv("SLACK_BOT_TOKEN", "test-token");
  vi.stubEnv("ALERTS_EMAIL", "ops@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("production operations alerts", () => {
  it("still alerts when the rate limiter itself fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = createInMemoryRepos();
    repos.rateLimit.hit = async () => {
      throw new Error("database is down");
    };
    await sendOperationsAlert(repos, failedDm);
    expect(postMessage).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("posts a failed DM alert to the configured staff channel without member content", async () => {
    const { repos, hit } = allowing();
    await sendOperationsAlert(repos, failedDm);

    expect(hit).toHaveBeenCalledWith(expect.any(String), 600, 1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "C0CA91G8LGH", text: expect.stringContaining("member ID: m1") }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("suppresses another alert in the same rate-limit window", async () => {
    const repos = createInMemoryRepos();
    await sendOperationsAlert(repos, failedDm);
    await sendOperationsAlert(repos, failedDm);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("emails operations when the Slack bot cannot post", async () => {
    postMessage.mockRejectedValueOnce(new Error("channel_not_found"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendOperationsAlert(allowing().repos, failedDm);

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@example.com", subject: "[Hub alert] Slack notification DM failed" }));
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { operations_alert: "slack_dm_failed", alert_channel: "slack" } }));
    error.mockRestore();
  });

  it("batches ambiguous matches into one alert", async () => {
    await sendOperationsAlert(allowing().repos, {
      type: "ambiguous_slack_member_match",
      collisions: [{ reason: "multiple_slack_users", slackUserIds: ["U1", "U2"], memberIds: ["m1"] }],
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].text).toContain("1 ambiguous Slack member match(es) rejected");
  });

  it("names the job and lists each problem for a scheduled job that did not finish cleanly", async () => {
    await sendOperationsAlert(allowing().repos, {
      type: "cron_partial_failure",
      job: "reconcile-slack",
      problems: ["Silver step chat failed: statement timeout", "capture: channel members: boom"],
    });
    const text = postMessage.mock.calls[0][0].text;
    expect(text).toContain("reconcile-slack");
    expect(text).toContain("Silver step chat failed: statement timeout");
    expect(text).toContain("capture: channel members: boom");
  });

  it("names the section and calls a statement timeout one, with no member content", async () => {
    const { repos, hit } = allowing();
    await sendOperationsAlert(repos, { type: "section_failed", section: "member page: activity feed", code: "57014", ms: 8012 });

    expect(hit).toHaveBeenCalledWith("operations_alert:section_failed:member page: activity feed", 600, 1);
    const text = postMessage.mock.calls[0][0].text;
    expect(text).toContain("timed out in the database");
    expect(text).toContain("member page: activity feed");
    expect(text).toContain(`<${sentrySectionSearchUrl("member page: activity feed")}|Sentry>`);
    expect(sentrySectionSearchUrl("member page: activity feed")).toBe(
      `https://${appConfig.sentry.org}.sentry.io/issues/?query=section%3A%22member+page%3A+activity+feed%22&statsPeriod=24h&sort=date`,
    );
  });

  it("words a section failure by its code, or without one", async () => {
    const { repos } = allowing();
    await sendOperationsAlert(repos, { type: "section_failed", section: "a", code: "42501", ms: 5 });
    await sendOperationsAlert(repos, { type: "section_failed", section: "b", ms: 5 });

    expect(postMessage.mock.calls[0][0].text).toContain('"a" failed (42501) after 5 ms');
    expect(postMessage.mock.calls[1][0].text).toContain('"b" failed after 5 ms');
  });

  it("alerts a browser crash by route, with the untrusted message trimmed and escaped", async () => {
    const { repos, hit } = allowing();
    await sendOperationsAlert(repos, { type: "client_crash", route: "/admin/events/[id]", message: `Error: <b>a & b</b>\n${"x".repeat(500)}` });

    expect(hit).toHaveBeenCalledWith("operations_alert:client_crash:/admin/events/[id]", 600, 1);
    const text = postMessage.mock.calls[0][0].text;
    expect(text).toContain("/admin/events/[id] crashed in a member's or admin's browser");
    expect(text).toContain("&lt;b&gt;a &amp; b&lt;/b&gt; xxx");
    expect(text).not.toContain("x".repeat(201));
  });
});
