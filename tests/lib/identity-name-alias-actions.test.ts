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

// Aliases are stored through the repository; the twin stands in for it.
const aliasStore = vi.hoisted(() => ({ repo: null as unknown }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...real, createRepos: (db: never) => ({ ...real.createRepos(db), aliases: aliasStore.repo as never }) };
});

// The conflict check runs as the service role (members can't read each other's names).
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc: rpcMock }),
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryAliasRepository } from "@/lib/data/aliases";
import { addNameAlias } from "@/app/(member)/settings/identityActions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { SUPPORT_EMAIL } from "@/lib/config";

const IDENTITY = { memberId: "member-1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false };

let data: InMemoryDataset;
const saved = () => data.nameAliases.map((a) => ({ member_id: a.member_id, alias: a.alias, source: a.source }));

function makeClient() {
  return { from: vi.fn() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  data = new InMemoryDataset();
  aliasStore.repo = new InMemoryAliasRepository(data);
  afterCallbacks.length = 0;
  rpcMock.mockResolvedValue({ data: [], error: null });
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "login@example.com" } as any);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as any);
});

describe("addNameAlias", () => {
  it("checks the trimmed name against everyone's names for the acting member, then saves it", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addNameAlias("  Ada E  ")).toEqual({ success: true });

    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: "member-1", p_alias: "Ada E" });
    expect(saved()).toEqual([{ member_id: "member-1", alias: "Ada E", source: "member" }]);
  });

  it("checks for the sudo'd member, not the admin", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "sudo-member", isSudo: true } as any);
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    await addNameAlias("Ada E");

    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: "sudo-member", p_alias: "Ada E" });
  });

  it("reprocesses recent attendance after saving", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    await addNameAlias("Ada E");
    await Promise.all(afterCallbacks.map((fn) => fn()));

    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_name_aliases", "local");
  });

  it.each([
    ["own", "already on your list"],
    ["own_inactive", SUPPORT_EMAIL],
    ["other_alias", SUPPORT_EMAIL],
    ["other_name", SUPPORT_EMAIL],
  ])("won't save a name that conflicts (%s) and says why", async (conflict, snippet) => {
    rpcMock.mockResolvedValue({ data: [{ kind: conflict, other_member_id: "member-2", other_member_name: "Katie Peters" }], error: null });
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    const result = await addNameAlias("Katie P");

    expect(result).toEqual({ error: expect.stringContaining(snippet) });
    expect(saved()).toEqual([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("tells the two 'someone else's' conflicts apart", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    rpcMock.mockResolvedValue({ data: [{ kind: "other_alias", other_member_id: "member-2", other_member_name: "Katie Peters" }], error: null });
    const alias = await addNameAlias("Katie P");
    rpcMock.mockResolvedValue({ data: [{ kind: "other_name", other_member_id: "member-2", other_member_name: "Katie Peters" }], error: null });
    const name = await addNameAlias("Katie P");

    expect(alias).not.toEqual(name);
    expect(JSON.stringify([alias, name])).not.toContain("Katie Peters");
    expect(name).toEqual({ error: expect.stringContaining("another member's name") });
  });

  it("falls back to the 'already used' message for a conflict kind it doesn't know", async () => {
    rpcMock.mockResolvedValue({ data: [{ kind: "something_new", other_member_id: null, other_member_name: null }], error: null });
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addNameAlias("Katie P")).toEqual({ error: expect.stringContaining("already uses that name") });
    expect(saved()).toEqual([]);
  });

  it("doesn't save when the check itself fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addNameAlias("Katie P")).toEqual({ error: "rpc down" });
    expect(saved()).toEqual([]);
  });

  it("still refuses a race: the same text added by someone else between the check and the insert", async () => {
    data.nameAliases.push({ id: "nal_other", member_id: "member-2", alias: "Katie P", source: "member", active: true });
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addNameAlias("Katie P")).toEqual({ error: expect.stringContaining("already uses that name") });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("rejects an empty or overlong name before checking anything", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client);

    expect(await addNameAlias("   ")).toEqual({ error: "Enter a name first" });
    expect(await addNameAlias("x".repeat(201))).toEqual({ error: "That name is too long" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
