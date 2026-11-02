import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { LAUNCH_SENT_MARK, LAUNCH_SIGN_IN_URL, renderLaunchEmail, sendLaunchEmails, type LaunchAuthApi, type LaunchUser } from "@/lib/launch-email";
import { useFakeClock } from "@/tests/helpers/fake-clock";

function fakeAuth(users: LaunchUser[], opts: { codeFor?: (email: string) => string | undefined } = {}) {
  const calls = { generate: [] as string[], marked: [] as string[] };
  const api: LaunchAuthApi = {
    async listUsers({ page, perPage }) {
      return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
    },
    async createUser() {
      throw new Error("not used");
    },
    async updateUserById(id, attrs) {
      calls.marked.push(id);
      const u = users.find((x) => x.id === id)!;
      u.app_metadata = { ...u.app_metadata, ...attrs.app_metadata };
      return { data: null, error: null };
    },
    async generateLink({ email }) {
      calls.generate.push(email);
      const code = opts.codeFor ? opts.codeFor(email) : "12345678";
      return { data: { properties: code ? { email_otp: code } : null }, error: null };
    },
  };
  return { api, calls };
}

const members = (extra: object[] = []) =>
  createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "u1" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test", userId: "u2" },
        { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test", userId: "u3" },
        { id: "mbr_AAAAAAAAAAA4", name: "Di Example", email: "di@example.test", userId: "u4" },
        { id: "mbr_AAAAAAAAAAA5", name: "Ed Example", email: "ed@example.test", userId: "u5" },
        { id: "mbr_AAAAAAAAAAA6", name: "Flo Example", email: "flo@example.test", status: "on_hiatus", userId: "u6" },
        ...extra,
      ] as never,
    })
  ).members;

const NOW = new Date("2026-11-02T15:00:00Z");
const users = (): LaunchUser[] => [
  { id: "u1", email: "ada@example.test" },
  { id: "u2", email: "bo@example.test", banned_until: "2999-01-01T00:00:00Z" },
  { id: "u3", email: "cy@example.test", last_sign_in_at: "2026-11-02T10:00:00Z" },
  { id: "u4", email: "di@example.test", app_metadata: { [LAUNCH_SENT_MARK]: "2026-11-02T14:00:00Z" } },
  { id: "u5", email: "ed@example.test", banned_until: "2020-01-01T00:00:00Z" },
  { id: "u6", email: "flo@example.test", banned_until: "2999-01-01T00:00:00Z" },
];

describe("sendLaunchEmails", () => {
  const fake = useFakeClock();

  it("sends only to released, never-signed-in members who have not had it, with their own code, and marks them", async () => {
    const sent: { to: string; text: string; html: string }[] = [];
    const auth = fakeAuth(users(), { codeFor: (e) => (e.startsWith("ada") ? "11111111" : "22222222") });

    const report = await sendLaunchEmails(auth.api, members(), async (m) => void sent.push(m), { apply: true, now: NOW });

    expect(sent.map((m) => m.to)).toEqual(["ada@example.test", "ed@example.test"]);
    expect(sent[0].text).toContain("11111111");
    expect(sent[1].text).toContain("22222222");
    expect(sent[0].html).toContain(LAUNCH_SIGN_IN_URL);
    expect(report).toMatchObject({ considered: 5, sent: 2, alreadySent: 1, alreadySignedIn: 1, stillBanned: 1, failed: 0 });
    expect(auth.calls.marked).toEqual(["u1", "u5"]);
  });

  it("is idempotent: a second run sends nothing", async () => {
    const auth = fakeAuth(users());
    const send = async () => {};
    await sendLaunchEmails(auth.api, members(), send, { apply: true, now: NOW });
    const second = await sendLaunchEmails(auth.api, members(), send, { apply: true, now: NOW });
    expect(second).toMatchObject({ sent: 0, alreadySent: 3 });
  });

  it("dry run counts but sends, generates and marks nothing", async () => {
    const auth = fakeAuth(users());
    const sent: unknown[] = [];
    const report = await sendLaunchEmails(auth.api, members(), async (m) => void sent.push(m), { apply: false, now: NOW });
    expect(report.sent).toBe(2);
    expect(sent).toEqual([]);
    expect(auth.calls.generate).toEqual([]);
    expect(auth.calls.marked).toEqual([]);
  });

  it("stops at --limit and defers the rest to the next run", async () => {
    const auth = fakeAuth(users());
    const report = await sendLaunchEmails(auth.api, members(), async () => {}, { apply: true, limit: 1, now: NOW });
    expect(report).toMatchObject({ sent: 1, deferred: 1 });
  });

  it("pauses between batches of the given size", async () => {
    const auth = fakeAuth(users());
    await sendLaunchEmails(auth.api, members(), async () => {}, { apply: true, batchSize: 1, pauseMs: 60_000, now: NOW });
    expect(fake.clock.slept).toBe(60_000);
  });

  it("stops after a failed send and leaves everyone unmarked from there on", async () => {
    const auth = fakeAuth(users());
    const report = await sendLaunchEmails(
      auth.api,
      members(),
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
    const auth = fakeAuth(users(), { codeFor: (e) => (e.startsWith("ada") ? undefined : "33333333") });
    const sent: string[] = [];
    const report = await sendLaunchEmails(auth.api, members(), async (m) => void sent.push(m.to), { apply: true, now: NOW });
    expect(report).toMatchObject({ sent: 1, failed: 1 });
    expect(sent).toEqual(["ed@example.test"]);
  });

  it("counts members with no auth user", async () => {
    const auth = fakeAuth([]);
    expect(await sendLaunchEmails(auth.api, members(), async () => {}, { apply: true, now: NOW })).toMatchObject({ noAuthUser: 5, sent: 0 });
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
