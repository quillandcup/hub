/**
 * Verifying an email alias: the signed link names one alias and its address, expires, only confirms on the
 * button (`confirmVerification`), and the email goes out at most once a minute per alias.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { useFakeClock } from "../helpers/fake-clock";

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail }));

import {
  confirmVerification,
  lookupVerificationToken,
  RESEND_GAP_MS,
  sendVerificationEmail,
  signVerificationToken,
  verificationUrl,
} from "@/lib/email-verification";
import { APP_URL } from "@/lib/config";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const ADDRESS = "ada.old@example.com";
const fake = useFakeClock();

let dataset: InMemoryDataset;
let repos: ReturnType<typeof createInMemoryRepos>;
let aliasId: string;

beforeEach(async () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  sendEmail.mockReset().mockResolvedValue(undefined);
  dataset = new InMemoryDataset({
    members: [
      { id: ME, name: "Ada Example", email: "ada@example.com" },
      { id: OTHER, name: "Grace Example", email: "grace@example.com" },
    ],
  });
  repos = createInMemoryRepos(dataset);
  await repos.aliases.addEmail(ME, ADDRESS, "manual");
  aliasId = (await repos.aliases.findEmail(ADDRESS))!.id;
});

describe("the verification link", () => {
  it("opens an alias that is waiting, and confirms it only when the button is used", async () => {
    const token = signVerificationToken(aliasId, ADDRESS);

    expect(await lookupVerificationToken(repos, token)).toMatchObject({ state: "ready", alias: { id: aliasId, aliasEmail: ADDRESS } });
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).toBeNull();

    expect(await confirmVerification(repos, token)).toBe("verified");
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).not.toBeNull();
    expect(await lookupVerificationToken(repos, token)).toMatchObject({ state: "verified" });
    expect(await confirmVerification(repos, token)).toBe("verified");
  });

  it("is refused when it is cut off, forged, for another alias, missing a secret, or for an alias that is gone", async () => {
    const token = signVerificationToken(aliasId, ADDRESS);
    const [id, exp, sig] = token.split(".");
    for (const bad of [undefined, "", "nope", `${id}.${exp}`, `${id}.${exp}.${sig}x`, `${id}.${Number(exp) + 1}.${sig}`, `${OTHER}.${exp}.${sig}`]) {
      expect(await lookupVerificationToken(repos, bad)).toEqual({ state: "invalid" });
    }
    expect(await confirmVerification(repos, `${id}.${exp}.forged`)).toBe("invalid");

    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(await lookupVerificationToken(repos, token)).toEqual({ state: "invalid" });
  });

  it("stops working after seven days, and when the address was changed after it was sent", async () => {
    const token = signVerificationToken(aliasId, ADDRESS);

    dataset.emailAliases.find((a) => a.id === aliasId)!.alias_email = "someone.else@example.com";
    expect(await lookupVerificationToken(repos, token)).toEqual({ state: "invalid" });
    dataset.emailAliases.find((a) => a.id === aliasId)!.alias_email = ADDRESS;

    fake.clock.advance(7 * 24 * 3_600_000 + 2000);
    expect(await lookupVerificationToken(repos, token)).toEqual({ state: "expired" });
    expect(await confirmVerification(repos, token)).toBe("expired");
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).toBeNull();
  });
});

describe("sendVerificationEmail", () => {
  it("emails the link to the alias address, tagged for the member's timeline", async () => {
    expect(await sendVerificationEmail(repos, ME, aliasId)).toEqual({ ok: true });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: ADDRESS, tags: { kind: "email_verification", member: ME } });
    expect(mail.html).toContain(`${APP_URL}/verify-email?t=${aliasId}.`);
    expect(mail.text).toContain(ADDRESS);
    // The link in the mail is one the page accepts.
    const token = new URL(/https?:\/\/[^\s"<]+verify-email\?t=[\w.-]+/.exec(mail.text)![0]).searchParams.get("t");
    expect(await lookupVerificationToken(repos, token)).toMatchObject({ state: "ready" });
    expect(verificationUrl("x")).toBe(`${APP_URL}/verify-email?t=x`);
  });

  it("sends once a minute per alias", async () => {
    await sendVerificationEmail(repos, ME, aliasId);

    const again = await sendVerificationEmail(repos, ME, aliasId);
    expect(again).toMatchObject({ ok: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    fake.clock.advance(RESEND_GAP_MS + 1);
    expect(await sendVerificationEmail(repos, ME, aliasId)).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("won't send for another member's alias, an unknown alias, or one that is already confirmed", async () => {
    expect(await sendVerificationEmail(repos, OTHER, aliasId)).toEqual({ ok: false, error: "That email isn't on your account." });
    expect(await sendVerificationEmail(repos, ME, "eal_missing")).toEqual({ ok: false, error: "That email isn't on your account." });
    await repos.aliases.markEmailVerified(aliasId, ADDRESS);
    expect(await sendVerificationEmail(repos, ME, aliasId)).toEqual({ ok: false, error: "That email is already confirmed." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("says so when the email can't be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmail.mockRejectedValue(new Error("Resend is down"));

    expect(await sendVerificationEmail(repos, ME, aliasId)).toEqual({ ok: false, error: "Couldn't send the email. Try again in a minute." });
  });
});
