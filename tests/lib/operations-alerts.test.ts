import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMessage = vi.hoisted(() => vi.fn(async (message: { channel: string; text: string }) => { void message; }));
const sendEmail = vi.hoisted(() => vi.fn(async () => {}));
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@slack/web-api", () => ({ WebClient: class { chat = { postMessage }; } }));
vi.mock("@/lib/config", () => ({ isProduction: true, SLACK_ALERTS_CHANNEL_ID: "C0CA91G8LGH" }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { sendOperationsAlert } from "@/lib/operations-alerts";

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
  it("posts a failed DM alert to the configured staff channel without member content", async () => {
    const service = { rpc: vi.fn(async () => ({ data: true, error: null })) };
    await sendOperationsAlert(service, failedDm);

    expect(service.rpc).toHaveBeenCalledWith("rate_limit_hit", expect.objectContaining({ p_max_hits: 1 }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "C0CA91G8LGH", text: expect.stringContaining("member ID: m1") }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("suppresses another alert in the same rate-limit window", async () => {
    const service = { rpc: vi.fn(async () => ({ data: false, error: null })) };
    await sendOperationsAlert(service, failedDm);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("emails operations when the Slack bot cannot post", async () => {
    postMessage.mockRejectedValueOnce(new Error("channel_not_found"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendOperationsAlert({ rpc: async () => ({ data: true, error: null }) }, failedDm);

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@example.com", subject: "[Hub alert] Slack notification DM failed" }));
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { operations_alert: "slack_dm_failed", alert_channel: "slack" } }));
    error.mockRestore();
  });

  it("batches ambiguous matches into one alert", async () => {
    await sendOperationsAlert({ rpc: async () => ({ data: true, error: null }) }, {
      type: "ambiguous_slack_member_match",
      collisions: [{ reason: "multiple_slack_users", slackUserIds: ["U1", "U2"], memberIds: ["m1"] }],
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].text).toContain("1 ambiguous Slack member match(es) rejected");
  });

  it("names the job and lists each problem for a scheduled job that did not finish cleanly", async () => {
    await sendOperationsAlert({ rpc: async () => ({ data: true, error: null }) }, {
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
    const service = { rpc: vi.fn(async () => ({ data: true, error: null })) };
    await sendOperationsAlert(service, { type: "section_failed", section: "member page: activity feed", code: "57014", ms: 8012 });

    expect(service.rpc).toHaveBeenCalledWith("rate_limit_hit", expect.objectContaining({ p_bucket: "operations_alert:section_failed:member page: activity feed" }));
    const text = postMessage.mock.calls[0][0].text;
    expect(text).toContain("timed out in the database");
    expect(text).toContain("member page: activity feed");
  });

  it("words a section failure by its code, or without one", async () => {
    const service = { rpc: vi.fn(async () => ({ data: true, error: null })) };
    await sendOperationsAlert(service, { type: "section_failed", section: "a", code: "42501", ms: 5 });
    await sendOperationsAlert(service, { type: "section_failed", section: "b", ms: 5 });

    expect(postMessage.mock.calls[0][0].text).toContain('"a" failed (42501) after 5 ms');
    expect(postMessage.mock.calls[1][0].text).toContain('"b" failed after 5 ms');
  });
});
