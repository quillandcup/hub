import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail }));

import { EMAIL_CHANGED_SUBJECT, sendPrimaryEmailChangedNotice } from "@/lib/email-change-notice";
import { SUPPORT_EMAIL } from "@/lib/config";

beforeEach(() => sendEmail.mockReset().mockResolvedValue(undefined));

describe("sendPrimaryEmailChangedNotice", () => {
  it("tells the new address what to sign in with and the old one it no longer works, tagged for the member's timeline", async () => {
    await sendPrimaryEmailChangedNotice("mbr_AAAAAAAAAAA1", "old@example.com", "new@example.com");

    const byTo = new Map(sendEmail.mock.calls.map(([mail]) => [mail.to, mail]));
    expect([...byTo.keys()].sort()).toEqual(["new@example.com", "old@example.com"]);
    for (const mail of byTo.values()) {
      expect(mail).toMatchObject({ subject: EMAIL_CHANGED_SUBJECT, tags: { kind: "email_changed", member: "mbr_AAAAAAAAAAA1" } });
      expect(mail.text).toContain("from old@example.com to new@example.com");
      expect(mail.text).toContain(SUPPORT_EMAIL);
    }
    expect(byTo.get("new@example.com")!.text).toContain("Sign in with new@example.com from now on");
    expect(byTo.get("old@example.com")!.text).toContain("You can no longer sign in with old@example.com");
  });

  it("still sends to the other address, and doesn't throw, when one send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmail.mockRejectedValueOnce(new Error("Resend is down"));

    await expect(sendPrimaryEmailChangedNotice("mbr_AAAAAAAAAAA1", "old@example.com", "new@example.com")).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
