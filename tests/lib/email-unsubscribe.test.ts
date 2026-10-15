import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import {
  oneClickUnsubscribeUrl,
  parseUnsubscribeToken,
  setEmailEnabled,
  signUnsubscribeToken,
  unsubscribePageUrl,
} from "@/lib/email-unsubscribe";
import { APP_URL } from "@/lib/config";

const MEMBER = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllEnvs());

describe("unsubscribe tokens", () => {
  it("round-trips the member and kind", () => {
    expect(parseUnsubscribeToken(signUnsubscribeToken(MEMBER, "prickle_checkin"))).toEqual({
      memberId: MEMBER,
      kind: "prickle_checkin",
    });
  });

  it("rejects a token for a different member or kind than was signed", () => {
    const token = signUnsubscribeToken(MEMBER, "prickle_checkin");
    const [, , signature] = token.split(".");

    expect(parseUnsubscribeToken(`22222222-2222-4222-8222-222222222222.prickle_checkin.${signature}`)).toBeNull();
    expect(parseUnsubscribeToken(`${MEMBER}.prickle_checkout.${signature}`)).toBeNull();
  });

  it("rejects malformed, unknown-kind, tampered and empty tokens", () => {
    const token = signUnsubscribeToken(MEMBER, "prickle_checkin");

    expect(parseUnsubscribeToken(undefined)).toBeNull();
    expect(parseUnsubscribeToken("")).toBeNull();
    expect(parseUnsubscribeToken("nonsense")).toBeNull();
    expect(parseUnsubscribeToken(`${MEMBER}.carrier_pigeon.${token.split(".")[2]}`)).toBeNull();
    expect(parseUnsubscribeToken(`${token}x`)).toBeNull();
    expect(parseUnsubscribeToken(token.slice(0, -2))).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signUnsubscribeToken(MEMBER, "prickle_checkin");
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "another-secret");

    expect(parseUnsubscribeToken(token)).toBeNull();
  });

  it("won't sign, and accepts nothing, without a secret", () => {
    const token = signUnsubscribeToken(MEMBER, "prickle_checkin");
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");

    expect(() => signUnsubscribeToken(MEMBER, "prickle_checkin")).toThrow("EMAIL_UNSUBSCRIBE_SECRET");
    expect(parseUnsubscribeToken(token)).toBeNull();
  });

  it("builds the page and one-click URLs on the app's canonical host", () => {
    expect(unsubscribePageUrl("tok")).toBe(`${APP_URL}/unsubscribe?t=tok`);
    expect(oneClickUnsubscribeUrl("tok")).toBe(`${APP_URL}/api/email/unsubscribe?t=tok`);
  });
});

describe("setEmailEnabled", () => {
  it("stores an explicit choice for that member, kind and the email channel", async () => {
    const fake = createFakeSupabase();

    expect(await setEmailEnabled(fake, MEMBER, "prickle_checkin", false)).toBe(true);

    const call = fake.queries.find((q) => q.table === "notification_preferences")!.calls.find((c) => c.method === "upsert")!;
    expect(call.args).toEqual([
      { member_id: MEMBER, kind: "prickle_checkin", channel: "email", enabled: false },
      { onConflict: "member_id,kind,channel" },
    ]);
  });

  it("reports a failed save", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({ notification_preferences: { error: { message: "boom" } } });

    expect(await setEmailEnabled(fake, MEMBER, "prickle_checkin", false)).toBe(false);
    error.mockRestore();
  });
});
