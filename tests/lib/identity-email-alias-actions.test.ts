import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/kajabi/client", () => ({ createKajabiClient: vi.fn() }));

const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterCallbacks.push(fn);
  },
}));

const triggerReprocessingMock = vi.fn();
vi.mock("@/lib/processing/trigger", () => ({
  triggerReprocessing: (...args: unknown[]) => triggerReprocessingMock(...args),
}));

import { addEmailAlias, setEmailAliasActive, getIdentitySettings } from "@/app/(member)/settings/identityActions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "member-1", memberName: "Test Member", memberEmail: "Member@Example.com", isSudo: false };

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

/**
 * Records every query against the caller's session. `result(table, op)` picks
 * what each awaited query resolves with.
 */
function makeClient(result: (table: string, op: string) => { data?: unknown; error?: unknown } = () => ({})) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const resolveWith = () => ({ data: null, error: null, ...result(table, call.op) });
    const builder: any = {
      select: () => builder,
      insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), builder),
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), builder),
      eq: (col: string, val: unknown) => (call.filters.push(["eq", col, val]), builder),
      order: () => builder,
      single: () => Promise.resolve(resolveWith()),
      then: (resolve: (v: unknown) => unknown) => resolve(resolveWith()),
    };
    return builder;
  });
  return { client: { from } as any, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "login@example.com" } as any);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as any);
});

describe("addEmailAlias", () => {
  it("adds the alias to the acting member by member_id, lowercased and trimmed", async () => {
    const { client, calls } = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addEmailAlias("  Old.Me@Example.com ")).toEqual({ success: true });

    const insert = calls.find((c) => c.table === "member_email_aliases" && c.op === "insert");
    expect(insert?.payload).toEqual({ member_id: "member-1", alias_email: "old.me@example.com", source: "manual" });
  });

  it("uses the sudo'd member's id, not the admin's", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "sudo-member", isSudo: true } as any);
    const { client, calls } = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    await addEmailAlias("x@example.com");

    const insert = calls.find((c) => c.table === "member_email_aliases" && c.op === "insert");
    expect((insert?.payload as any).member_id).toBe("sudo-member");
  });

  it("triggers reprocessing after adding", async () => {
    const { client } = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    await addEmailAlias("x@example.com");
    await Promise.all(afterCallbacks.map((fn) => fn()));

    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_email_aliases", "local");
  });

  it("refuses the member's own primary email, case-insensitively", async () => {
    const { client, calls } = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addEmailAlias("MEMBER@example.com")).toEqual({ error: "That's already your primary email" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses an invalid email", async () => {
    const { client } = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);
    expect(await addEmailAlias("not-an-email")).toEqual({ error: "Enter a valid email address" });
  });

  it("explains a duplicate alias", async () => {
    const { client } = makeClient((table, op) =>
      table === "member_email_aliases" && op === "insert" ? { error: { code: "23505", message: "duplicate" } } : {}
    );
    vi.mocked(createClient).mockResolvedValue(client);

    const result = await addEmailAlias("taken@example.com");
    expect(result).toEqual({
      error: "That email is already registered as an alias, possibly for another member — ask an admin for help.",
    });
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("setEmailAliasActive", () => {
  it("scopes the toggle to the acting member by member_id", async () => {
    const { client, calls } = makeClient(() => ({ data: { id: "alias-1" } }));
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await setEmailAliasActive("alias-1", false)).toEqual({ success: true });

    const update = calls.find((c) => c.table === "member_email_aliases" && c.op === "update");
    expect(update?.payload).toEqual({ active: false });
    expect(update?.filters).toEqual([
      ["eq", "id", "alias-1"],
      ["eq", "member_id", "member-1"],
    ]);
  });

  it("reports an alias that isn't the member's", async () => {
    const { client } = makeClient(() => ({ data: null }));
    vi.mocked(createClient).mockResolvedValue(client);
    expect(await setEmailAliasActive("someone-elses", true)).toEqual({ error: "Alias not found" });
  });

  it("reprocesses on reactivation only", async () => {
    const { client } = makeClient(() => ({ data: { id: "alias-1" } }));
    vi.mocked(createClient).mockResolvedValue(client);

    await setEmailAliasActive("alias-1", false);
    expect(afterCallbacks).toHaveLength(0);
    await setEmailAliasActive("alias-1", true);
    expect(afterCallbacks).toHaveLength(1);
  });
});

describe("getIdentitySettings", () => {
  it("lists email aliases by member_id, so they survive a change of primary email", async () => {
    const { client, calls } = makeClient((table) =>
      table === "member_email_aliases"
        ? { data: [{ id: "a1", alias_email: "old@example.com", source: "auto_detected", active: true, created_at: "2026-01-01" }] }
        : {}
    );
    vi.mocked(createClient).mockResolvedValue(client);

    const settings = await getIdentitySettings();
    if ("error" in settings) throw new Error(settings.error);

    const aliasQuery = calls.find((c) => c.table === "member_email_aliases");
    expect(aliasQuery?.filters).toEqual([["eq", "member_id", "member-1"]]);
    expect(settings.emailAliases.map((a) => a.aliasEmail)).toEqual(["old@example.com"]);
  });
});
