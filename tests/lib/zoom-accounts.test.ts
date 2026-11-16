import { describe, expect, it } from "vitest";
import {
  PRIMARY_ZOOM_ACCOUNT_ID,
  buildKeepPolicy,
  isMeetingKept,
  meetingState,
  primaryZoomAccountRow,
  zoomCredentialNames,
  zoomCredentials,
  zoomWebhookSecret,
} from "@/lib/zoom-accounts";

const SECOND = "zacc_SecondAcct01";
const accounts = [
  { id: PRIMARY_ZOOM_ACCOUNT_ID, slug: "primary", defaultPolicy: "keep" as const },
  { id: SECOND, slug: "secondary", defaultPolicy: "exclude" as const },
];
const meeting = (zoomAccount: string | null, meetingUuid = "uuid-1", meetingId = "111") => ({ zoomAccount, meetingUuid, meetingId });

describe("which Zoom meetings are kept", () => {
  it("keeps the meetings of a keep account and leaves out those of an exclude account, by default", () => {
    const policy = buildKeepPolicy(accounts, []);

    expect(isMeetingKept(policy, meeting(PRIMARY_ZOOM_ACCOUNT_ID))).toBe(true);
    expect(isMeetingKept(policy, meeting(SECOND))).toBe(false);
    expect(meetingState(policy, meeting(SECOND))).toBe("undecided");
  });

  it("treats a row with no account as the primary account's", () => {
    const policy = buildKeepPolicy(accounts, []);

    expect(isMeetingKept(policy, meeting(null))).toBe(true);
    expect(isMeetingKept(policy, meeting(undefined as unknown as null))).toBe(true);
  });

  it("lets a decision on one meeting beat the account's default", () => {
    const policy = buildKeepPolicy(accounts, [
      { zoomAccount: SECOND, scope: "instance", zoomKey: "uuid-1", decision: "kept" },
      { zoomAccount: PRIMARY_ZOOM_ACCOUNT_ID, scope: "instance", zoomKey: "uuid-2", decision: "ignored" },
    ]);

    expect(isMeetingKept(policy, meeting(SECOND, "uuid-1"))).toBe(true);
    expect(isMeetingKept(policy, meeting(SECOND, "uuid-9"))).toBe(false);
    expect(isMeetingKept(policy, meeting(PRIMARY_ZOOM_ACCOUNT_ID, "uuid-2"))).toBe(false);
    expect(meetingState(policy, meeting(PRIMARY_ZOOM_ACCOUNT_ID, "uuid-2"))).toBe("ignored");
  });

  it("applies a decision on a link to every occurrence, with an occurrence's own decision winning", () => {
    const policy = buildKeepPolicy(accounts, [
      { zoomAccount: SECOND, scope: "series", zoomKey: "111", decision: "kept" },
      { zoomAccount: SECOND, scope: "instance", zoomKey: "uuid-2", decision: "ignored" },
    ]);

    expect(isMeetingKept(policy, meeting(SECOND, "uuid-1", "111"))).toBe(true);
    expect(isMeetingKept(policy, meeting(SECOND, "uuid-2", "111"))).toBe(false);
    expect(isMeetingKept(policy, meeting(SECOND, "uuid-3", "999"))).toBe(false);
  });

  it("does not let one account's decision touch another account's meeting with the same key", () => {
    const policy = buildKeepPolicy(accounts, [{ zoomAccount: SECOND, scope: "series", zoomKey: "111", decision: "kept" }]);

    expect(meetingState(policy, meeting(PRIMARY_ZOOM_ACCOUNT_ID, "uuid-1", "111"))).toBe("undecided");
  });

  it("leaves out a meeting of an account nobody set up, and everything when there is no primary account", () => {
    expect(isMeetingKept(buildKeepPolicy(accounts, []), meeting("zacc_Unknown00001"))).toBe(false);
    expect(isMeetingKept(buildKeepPolicy([], []), meeting(null))).toBe(false);
  });

  it("knows the primary account's row", () => {
    expect(primaryZoomAccountRow()).toMatchObject({ id: PRIMARY_ZOOM_ACCOUNT_ID, slug: "primary", default_policy: "keep", credentials_prefix: "ZOOM" });
  });
});

describe("Zoom credentials by prefix", () => {
  it("names the variables from the prefix, so the primary account's are the existing ones", () => {
    expect(zoomCredentialNames("ZOOM")).toEqual({
      accountId: "ZOOM_ACCOUNT_ID",
      clientId: "ZOOM_CLIENT_ID",
      clientSecret: "ZOOM_CLIENT_SECRET",
      userEmail: "ZOOM_USER_EMAIL",
      webhookSecret: "ZOOM_WEBHOOK_SECRET_TOKEN",
    });
    expect(zoomCredentialNames("ZOOM_SECONDARY").webhookSecret).toBe("ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN");
  });

  it("returns the credentials when all four are set, and null when any is missing", () => {
    const env = {
      ZOOM_SECONDARY_ACCOUNT_ID: "acct",
      ZOOM_SECONDARY_CLIENT_ID: "client",
      ZOOM_SECONDARY_CLIENT_SECRET: "secret",
      ZOOM_SECONDARY_USER_EMAIL: "ada@example.com",
    };

    expect(zoomCredentials("ZOOM_SECONDARY", env)).toEqual({ accountId: "acct", clientId: "client", clientSecret: "secret", userEmail: "ada@example.com" });
    expect(zoomCredentials("ZOOM_SECONDARY", { ...env, ZOOM_SECONDARY_CLIENT_SECRET: undefined })).toBeNull();
    expect(zoomCredentials("ZOOM_SECONDARY", {})).toBeNull();
  });

  it("returns a webhook secret only when it is set", () => {
    expect(zoomWebhookSecret("ZOOM_SECONDARY", { ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN: "s" })).toBe("s");
    expect(zoomWebhookSecret("ZOOM_SECONDARY", { ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN: "" })).toBeNull();
    expect(zoomWebhookSecret("ZOOM_SECONDARY", {})).toBeNull();
  });
});
