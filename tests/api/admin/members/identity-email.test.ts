import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getTestSupabaseAdminClient } from "../../../helpers/supabase";

/**
 * PATCH /api/admin/members/[id]: primary email and email aliases, against the
 * real local DB (Kajabi mocked). The point of an admin email change is that it
 * sticks: Kajabi is updated first and Bronze agrees, so a members reprocess
 * keeps the new email instead of putting the Kajabi one back.
 */
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));

const updateContactMock = vi.fn();
const fetchContactMock = vi.fn();
vi.mock("@/lib/kajabi/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kajabi/client")>();
  return { ...actual, createKajabiClient: () => ({ updateContact: updateContactMock, fetchContact: fetchContactMock }) };
});

const triggerReprocessingMock = vi.fn(async () => ({ processed: [] }));
vi.mock("@/lib/processing/trigger", () => ({
  triggerReprocessing: (...args: unknown[]) => triggerReprocessingMock(...(args as [])),
}));

const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => afterCallbacks.push(fn) };
});

import { requireAdmin } from "@/lib/supabase/api-auth";
import { PATCH } from "@/app/api/admin/members/[id]/route";
import { POST as processMembers } from "@/app/api/process/members/route";

const supabase = getTestSupabaseAdminClient();
const ts = Date.now();
const prefix = `admin-email-${ts}`;
const email = (label: string) => `${prefix}-${label}@example.com`;

async function patch(memberId: string, body: Record<string, unknown>) {
  const response = await PATCH(
    new NextRequest(`http://localhost/api/admin/members/${memberId}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: memberId }) }
  );
  return { status: response.status, body: await response.json() };
}

async function createMember(label: string, kajabi = true) {
  const kajabiId = kajabi ? `${prefix}-${label}` : null;
  if (kajabiId) {
    const { error } = await supabase.schema("bronze").from("kajabi_contacts").insert({
      kajabi_contact_id: kajabiId,
      email: email(label),
      name: `Admin Email ${label}`,
      created_at_kajabi: "2023-01-01T00:00:00Z",
      data: {},
    });
    if (error) throw error;
  }
  const { data, error } = await supabase
    .from("members")
    .insert({
      email: email(label),
      name: `Admin Email ${label}`,
      joined_at: "2023-01-01",
      status: "lead",
      source: kajabi ? "kajabi" : "staff",
      kajabi_id: kajabiId,
    })
    .select("id, kajabi_id")
    .single();
  if (error) throw error;
  return data as { id: string; kajabi_id: string | null };
}

async function memberEmail(id: string) {
  const { data } = await supabase.from("members").select("email").eq("id", id).single();
  return data!.email as string;
}

async function aliasesOf(id: string) {
  const { data } = await supabase
    .from("member_email_aliases")
    .select("alias_email, source, active")
    .eq("member_id", id)
    .order("alias_email");
  return data ?? [];
}

async function bronzeEmail(kajabiId: string) {
  const { data } = await supabase.schema("bronze").from("kajabi_contacts").select("email").eq("kajabi_contact_id", kajabiId).single();
  return data!.email as string;
}

function kajabiContact(id: string, contactEmail: string) {
  return {
    id,
    type: "contacts",
    attributes: { name: "Admin Email", email: contactEmail, created_at: "2023-01-01T00:00:00Z", updated_at: new Date().toISOString() },
  };
}

async function cleanup() {
  await supabase.from("member_email_aliases").delete().ilike("alias_email", `${prefix}-%`);
  await supabase.from("members").delete().ilike("email", `${prefix}-%`);
  await supabase.schema("bronze").from("kajabi_contacts").delete().ilike("kajabi_contact_id", `${prefix}-%`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase } as any);
  updateContactMock.mockResolvedValue({});
  fetchContactMock.mockImplementation(async (id: string) => kajabiContact(id, updateContactMock.mock.calls.at(-1)?.[1]?.email));
  await cleanup();
});

afterAll(cleanup);

describe("changing the primary email", () => {
  it("updates Kajabi, Bronze and the member, and keeps the old email as an alias", async () => {
    const m = await createMember("amy");

    const { status, body } = await patch(m.id, { email: `  ${email("amy-new").toUpperCase()} ` });
    expect(status).toBe(200);

    expect(updateContactMock).toHaveBeenCalledWith(m.kajabi_id, { email: email("amy-new") });
    expect(await bronzeEmail(m.kajabi_id!)).toBe(email("amy-new"));
    expect(await memberEmail(m.id)).toBe(email("amy-new"));
    expect(await aliasesOf(m.id)).toEqual([{ alias_email: email("amy"), source: "manual", active: true }]);
    expect(body.member.email).toBe(email("amy-new"));
    expect(body.emailAliases.map((a: any) => a.alias_email)).toEqual([email("amy")]);
  });

  it("survives a members reprocess (the Kajabi email isn't put back)", async () => {
    const m = await createMember("bea");
    await patch(m.id, { email: email("bea-new") });

    const response = await processMembers(new NextRequest("http://localhost/api/process/members", { method: "POST" }));
    expect(response.status).toBe(200);

    expect(await memberEmail(m.id)).toBe(email("bea-new"));
    expect((await aliasesOf(m.id)).map((a) => a.alias_email)).toEqual([email("bea")]);
  }, 60000);

  it("patches Bronze directly when the Kajabi refresh fails", async () => {
    const m = await createMember("cal");
    fetchContactMock.mockRejectedValue(new Error("Kajabi is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { status } = await patch(m.id, { email: email("cal-new") });
    expect(status).toBe(200);
    expect(await bronzeEmail(m.kajabi_id!)).toBe(email("cal-new"));
    expect(await memberEmail(m.id)).toBe(email("cal-new"));
  });

  it("changes nothing when Kajabi rejects the update", async () => {
    const m = await createMember("dan");
    updateContactMock.mockRejectedValue(new Error("Email has already been taken"));

    const { status, body } = await patch(m.id, { email: email("dan-new") });
    expect(status).toBe(502);
    expect(body.error).toBe("Email has already been taken");
    expect(await memberEmail(m.id)).toBe(email("dan"));
    expect(await bronzeEmail(m.kajabi_id!)).toBe(email("dan"));
    expect(await aliasesOf(m.id)).toEqual([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("updates only locally for a member with no Kajabi contact", async () => {
    const m = await createMember("eve", false);

    const { status } = await patch(m.id, { email: email("eve-new") });
    expect(status).toBe(200);
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(await memberEmail(m.id)).toBe(email("eve-new"));
    expect((await aliasesOf(m.id)).map((a) => a.alias_email)).toEqual([email("eve")]);
  });

  it("refuses another member's email and points at them", async () => {
    const m = await createMember("fay");
    const other = await createMember("gus");

    const { status, body } = await patch(m.id, { email: email("gus") });
    expect(status).toBe(409);
    expect(body.conflictingMemberId).toBe(other.id);
    expect(body.error).toMatch(/merge them instead/);
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(await memberEmail(m.id)).toBe(email("fay"));
  });

  it("refuses an email that is another member's alias", async () => {
    const m = await createMember("hal");
    const other = await createMember("ivy");
    await supabase.from("member_email_aliases").insert({ member_id: other.id, alias_email: email("ivy-old"), source: "manual" });

    const { status, body } = await patch(m.id, { email: email("ivy-old") });
    expect(status).toBe(409);
    expect(body.conflictingMemberId).toBe(other.id);
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("promotes one of the member's own aliases to primary", async () => {
    const m = await createMember("jo");
    await supabase.from("member_email_aliases").insert({ member_id: m.id, alias_email: email("jo-alt"), source: "manual" });

    const { status } = await patch(m.id, { email: email("jo-alt") });
    expect(status).toBe(200);
    expect(await memberEmail(m.id)).toBe(email("jo-alt"));
    expect(await aliasesOf(m.id)).toEqual([{ alias_email: email("jo"), source: "manual", active: true }]);
  });

  it("reactivates the old email if it was an inactive alias of the member's", async () => {
    const m = await createMember("kit");
    await patch(m.id, { email: email("kit-new") });
    const { data: alias } = await supabase.from("member_email_aliases").select("id").eq("alias_email", email("kit")).single();
    await supabase.from("member_email_aliases").update({ active: false }).eq("id", alias!.id);

    // Back to the old address, then away again.
    await patch(m.id, { email: email("kit") });
    await patch(m.id, { email: email("kit-new") });
    expect(await aliasesOf(m.id)).toEqual([{ alias_email: email("kit"), source: "manual", active: true }]);
  });

  it("treats the same email in another case as no change", async () => {
    const m = await createMember("lee");
    const { status } = await patch(m.id, { email: email("lee").toUpperCase() });
    expect(status).toBe(200);
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(await aliasesOf(m.id)).toEqual([]);
  });

  it("rejects an invalid email", async () => {
    const m = await createMember("max");
    const { status, body } = await patch(m.id, { email: "not-an-email" });
    expect(status).toBe(400);
    expect(body.error).toBe("Enter a valid email address");
  });

  it("schedules rematching after the change", async () => {
    const m = await createMember("ned");
    await patch(m.id, { email: email("ned-new") });
    await Promise.all(afterCallbacks.map((fn) => fn()));
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_email_aliases", "local");
  });
});

describe("other emails (aliases)", () => {
  it("adds an alias", async () => {
    const m = await createMember("oz");
    const { status, body } = await patch(m.id, { newEmailAlias: email("oz-zoom").toUpperCase() });
    expect(status).toBe(200);
    expect(await aliasesOf(m.id)).toEqual([{ alias_email: email("oz-zoom"), source: "manual", active: true }]);
    expect(body.emailAliases).toHaveLength(1);
    await Promise.all(afterCallbacks.map((fn) => fn()));
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_email_aliases", "local");
  });

  it("refuses the member's own email, a duplicate, and other members' emails", async () => {
    const m = await createMember("pat");
    const other = await createMember("quin");
    await patch(m.id, { newEmailAlias: email("pat-alt") });

    expect((await patch(m.id, { newEmailAlias: email("pat") })).status).toBe(400);
    expect((await patch(m.id, { newEmailAlias: email("pat-alt") })).status).toBe(409);
    const taken = await patch(m.id, { newEmailAlias: email("quin") });
    expect(taken.status).toBe(409);
    expect(taken.body.conflictingMemberId).toBe(other.id);
    expect((await aliasesOf(m.id)).map((a) => a.alias_email)).toEqual([email("pat-alt")]);
  });

  it("deactivates and reactivates an alias", async () => {
    const m = await createMember("ray");
    await patch(m.id, { newEmailAlias: email("ray-alt") });
    const { data: alias } = await supabase.from("member_email_aliases").select("id").eq("alias_email", email("ray-alt")).single();
    afterCallbacks.length = 0;

    expect((await patch(m.id, { emailAlias: { id: alias!.id, active: false } })).status).toBe(200);
    expect((await aliasesOf(m.id))[0].active).toBe(false);
    expect(afterCallbacks).toHaveLength(0);

    expect((await patch(m.id, { emailAlias: { id: alias!.id, active: true } })).status).toBe(200);
    expect((await aliasesOf(m.id))[0].active).toBe(true);
    expect(afterCallbacks).toHaveLength(1);
  });

  it("won't toggle another member's alias", async () => {
    const m = await createMember("sam");
    const other = await createMember("tess");
    const { data: alias } = await supabase
      .from("member_email_aliases")
      .insert({ member_id: other.id, alias_email: email("tess-alt"), source: "manual" })
      .select("id")
      .single();

    const { status } = await patch(m.id, { emailAlias: { id: alias!.id, active: false } });
    expect(status).toBe(404);
    expect((await aliasesOf(other.id))[0].active).toBe(true);
  });
});
