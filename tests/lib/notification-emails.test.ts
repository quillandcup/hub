import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config";
import { oneClickUnsubscribeUrl, signUnsubscribeToken, unsubscribePageUrl } from "@/lib/email-unsubscribe";

const sendEmail = vi.fn(
  async (_params: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }) => {}
);
vi.mock("@/lib/email", () => ({ sendEmail: (p: any) => sendEmail(p) }));

vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: vi.fn(async () => new Map()) }));

const { NOTIFICATION_KINDS, effectiveChannels } = await import("@/lib/notifications/registry");
const { createNotifier, NOTIFICATION_SETTINGS_PATH } = await import("@/lib/notifications/notify");
const { renderNotificationEmail } = await import("@/emails/notifications");

const url = `${APP_URL}/prickles/p1/checkin`;
const settingsUrl = `${APP_URL}${NOTIFICATION_SETTINGS_PATH}`;
const members = { members: { data: [{ id: "m1", email: "alice@example.com" }, { id: "m2", email: null }] } };

beforeEach(() => sendEmail.mockClear());

describe("notification email templates", () => {
  it.each(NOTIFICATION_KINDS.map((k) => k.id))("renders %s with the message, its link and the settings link", async (kind) => {
    const { subject, html, text } = await renderNotificationEmail(kind, {
      text: "Ready for Morning Writing?",
      url,
      footerLinks: [{ label: "Notification settings", url: settingsUrl }],
    });

    expect(subject).toBe("Ready for Morning Writing?");
    expect(html).toContain("Ready for Morning Writing?");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`href="${settingsUrl}"`);
    expect(html).toContain(SUPPORT_EMAIL);
    expect(text).toContain("Ready for Morning Writing?");
    expect(text).toContain(url);
    expect(text).not.toContain("<");
  });

  it("leaves out the button when the message has no link", async () => {
    const { html } = await renderNotificationEmail("prickle_checkin", { text: "No link" });

    expect(html).toContain("No link");
    expect(html).not.toContain("Button not working");
  });
});

describe("email channel", () => {
  const optIn = (memberId: string) => ({ member_id: memberId, kind: "prickle_checkin", channel: "email", enabled: true });

  it("is off by default: no kind sends it until the member opts in", () => {
    for (const kind of NOTIFICATION_KINDS) expect(effectiveChannels(kind.id, [])).not.toContain("email");
  });

  it("doesn't email a member who never chose", async () => {
    const notifier = await createNotifier(createFakeSupabase(members), "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails a member who opted in, at the address on their record", async () => {
    const fake = createFakeSupabase({ ...members, notification_preferences: { data: [optIn("m1")] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);

    expect(notifier.channelsFor("m1")).toContain("email");
    const delivered = await notifier.send("m1", { text: "Ready for Morning Writing?", url });

    expect(delivered).toContain("email");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("alice@example.com");
    expect(sent.subject).toBe("Ready for Morning Writing?");
    expect(sent.html).toContain(`href="${settingsUrl}"`);

    // A per-kind unsubscribe: footer link to the page, plus the headers behind mail clients' own button.
    const token = signUnsubscribeToken("m1", "prickle_checkin");
    expect(sent.html).toContain(`href="${unsubscribePageUrl(token)}"`);
    expect(sent.html).toContain("Unsubscribe from “Prickle check-ins” emails");
    expect(sent.headers).toEqual({
      "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("can't reach an opted-in member with no email address", async () => {
    const fake = createFakeSupabase({ ...members, notification_preferences: { data: [optIn("m2")] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m2"]);

    expect(notifier.channelsFor("m2")).not.toContain("email");
  });
});
