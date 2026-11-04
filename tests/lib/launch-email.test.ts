import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/data/auth-users";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { LAUNCH_SENT_MARK, LAUNCH_SIGN_IN_URL, renderLaunchEmail, sendLaunchEmails } from "@/lib/launch-email";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const authUser = (id: string, email: string, extra: Partial<AuthUser> = {}): AuthUser => ({
  id,
  email,
  confirmed: true,
  createdAt: "2026-10-01T00:00:00Z",
  bannedUntil: null,
  lastSignInAt: null,
  appMetadata: {},
  ...extra,
});

/** The repositories over the members below and these auth accounts, with spies on what the run asks of Auth. */
function setup(authUsers: AuthUser[], opts: { codeFor?: (email: string) => string | undefined } = {}) {
  const data = new InMemoryDataset({
    authUsers,
    members: [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "u1" },
      { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test", userId: "u2" },
      { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test", userId: "u3" },
      { id: "mbr_AAAAAAAAAAA4", name: "Di Example", email: "di@example.test", userId: "u4" },
      { id: "mbr_AAAAAAAAAAA5", name: "Ed Example", email: "ed@example.test", userId: "u5" },
      { id: "mbr_AAAAAAAAAAA6", name: "Flo Example", email: "flo@example.test", status: "on_hiatus", userId: "u6" },
    ] as never,
  });
  const repos = createInMemoryRepos(data);
  const calls = { generate: [] as string[], marked: [] as string[] };
  vi.spyOn(repos.authUsers, "generateMagicLink").mockImplementation(async (id) => {
    const email = data.authUsers.find((u) => u.id === id)!.email!;
    calls.generate.push(email);
    const code = opts.codeFor ? opts.codeFor(email) : "12345678";
    if (!code) throw new Error("no code");
    return { hashedToken: "hash", code };
  });
  const merge = repos.authUsers.mergeAppMetadata.bind(repos.authUsers);
  vi.spyOn(repos.authUsers, "mergeAppMetadata").mockImplementation(async (id, meta) => {
    calls.marked.push(id);
    await merge(id, meta);
  });
  return { repos, calls };
}

const NOW = new Date("2026-11-02T15:00:00Z");
const users = (): AuthUser[] => [
  authUser("u1", "ada@example.test"),
  authUser("u2", "bo@example.test", { bannedUntil: "2999-01-01T00:00:00Z" }),
  authUser("u3", "cy@example.test", { lastSignInAt: "2026-11-02T10:00:00Z" }),
  authUser("u4", "di@example.test", { appMetadata: { [LAUNCH_SENT_MARK]: "2026-11-02T14:00:00Z" } }),
  authUser("u5", "ed@example.test", { bannedUntil: "2020-01-01T00:00:00Z" }),
  authUser("u6", "flo@example.test", { bannedUntil: "2999-01-01T00:00:00Z" }),
];

describe("sendLaunchEmails", () => {
  const fake = useFakeClock();

  it("sends only to released, never-signed-in members who have not had it, with their own code, and marks them", async () => {
    const sent: { to: string; text: string; html: string }[] = [];
    const auth = setup(users(), { codeFor: (e) => (e.startsWith("ada") ? "11111111" : "22222222") });

    const report = await sendLaunchEmails(auth.repos, async (m) => void sent.push(m), { apply: true, now: NOW });

    expect(sent.map((m) => m.to)).toEqual(["ada@example.test", "ed@example.test"]);
    expect(sent[0].text).toContain("11111111");
    expect(sent[1].text).toContain("22222222");
    expect(sent[0].html).toContain(LAUNCH_SIGN_IN_URL);
    expect(report).toMatchObject({ considered: 5, sent: 2, alreadySent: 1, alreadySignedIn: 1, stillBanned: 1, failed: 0 });
    expect(auth.calls.marked).toEqual(["u1", "u5"]);
  });

  it("reports who was sent, in member-id order, and tells onRecipient as each goes", async () => {
    const auth = setup(users());
    const told: string[] = [];
    const report = await sendLaunchEmails(auth.repos, async () => {}, { apply: true, now: NOW, onRecipient: (r) => told.push(r.memberId) });
    expect(report.recipients).toEqual([
      { memberId: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" },
      { memberId: "mbr_AAAAAAAAAAA5", name: "Ed Example", email: "ed@example.test" },
    ]);
    expect(told).toEqual(["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA5"]);
  });

  it("a dry run lists who would be sent too, without sending", async () => {
    const auth = setup(users());
    const report = await sendLaunchEmails(auth.repos, async () => {}, { apply: false, now: NOW });
    expect(report.recipients.map((r) => r.memberId)).toEqual(["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA5"]);
  });

  it("does not list someone whose send failed", async () => {
    const auth = setup(users());
    const report = await sendLaunchEmails(auth.repos, async () => { throw new Error("nope"); }, { apply: true, now: NOW });
    expect(report.recipients).toEqual([]);
  });

  it("is idempotent: a second run sends nothing", async () => {
    const auth = setup(users());
    const send = async () => {};
    await sendLaunchEmails(auth.repos, send, { apply: true, now: NOW });
    const second = await sendLaunchEmails(auth.repos, send, { apply: true, now: NOW });
    expect(second).toMatchObject({ sent: 0, alreadySent: 3 });
  });

  it("dry run counts but sends, generates and marks nothing", async () => {
    const auth = setup(users());
    const sent: unknown[] = [];
    const report = await sendLaunchEmails(auth.repos, async (m) => void sent.push(m), { apply: false, now: NOW });
    expect(report.sent).toBe(2);
    expect(sent).toEqual([]);
    expect(auth.calls.generate).toEqual([]);
    expect(auth.calls.marked).toEqual([]);
  });

  it("with onlyEmail, considers and sends to that one member only (any letter case), and marks only them", async () => {
    const auth = setup(users());
    const sent: string[] = [];
    const report = await sendLaunchEmails(auth.repos, async (m) => void sent.push(m.to), { apply: true, onlyEmail: " ED@example.test ", now: NOW });
    expect(sent).toEqual(["ed@example.test"]);
    expect(report).toMatchObject({ considered: 1, sent: 1 });
    expect(auth.calls.marked).toEqual(["u5"]);
  });

  it("with onlyEmail for someone not eligible, sends nothing", async () => {
    const auth = setup(users());
    const report = await sendLaunchEmails(auth.repos, async () => {}, { apply: true, onlyEmail: "bo@example.test", now: NOW });
    expect(report).toMatchObject({ considered: 1, sent: 0, stillBanned: 1 });
  });

  it("stops at --limit and defers the rest to the next run", async () => {
    const auth = setup(users());
    const report = await sendLaunchEmails(auth.repos, async () => {}, { apply: true, limit: 1, now: NOW });
    expect(report).toMatchObject({ sent: 1, deferred: 1 });
  });

  it("pauses between batches of the given size", async () => {
    const auth = setup(users());
    await sendLaunchEmails(auth.repos, async () => {}, { apply: true, batchSize: 1, pauseMs: 60_000, now: NOW });
    expect(fake.clock.slept).toBe(60_000);
  });

  it("stops after a failed send and leaves everyone unmarked from there on", async () => {
    const auth = setup(users());
    const report = await sendLaunchEmails(
      auth.repos,
      async () => {
        throw new Error("Resend responded 429: daily quota");
      },
      { apply: true, now: NOW }
    );
    expect(report).toMatchObject({ sent: 0, failed: 1, failedMemberIds: ["mbr_AAAAAAAAAAA1"] });
    expect(auth.calls.marked).toEqual([]);
    expect(auth.calls.generate).toHaveLength(1);
  });

  it("counts a member whose code could not be made as failed and carries on", async () => {
    const auth = setup(users(), { codeFor: (e) => (e.startsWith("ada") ? undefined : "33333333") });
    const sent: string[] = [];
    const report = await sendLaunchEmails(auth.repos, async (m) => void sent.push(m.to), { apply: true, now: NOW });
    expect(report).toMatchObject({ sent: 1, failed: 1 });
    expect(sent).toEqual(["ed@example.test"]);
  });

  it("counts members with no auth user", async () => {
    const auth = setup([]);
    expect(await sendLaunchEmails(auth.repos, async () => {}, { apply: true, now: NOW })).toMatchObject({ noAuthUser: 5, sent: 0 });
  });
});

describe("renderLaunchEmail", () => {
  it("shows the code and the sign-in page, not a link that carries the code", async () => {
    const mail = await renderLaunchEmail("98765432");
    expect(mail.html).toContain("98765432");
    expect(mail.html).toContain(LAUNCH_SIGN_IN_URL);
    expect(mail.html).not.toContain("98765432&");
    expect(LAUNCH_SIGN_IN_URL).not.toContain("98765432");
    expect(mail.text).toContain("98765432");
  });
});
