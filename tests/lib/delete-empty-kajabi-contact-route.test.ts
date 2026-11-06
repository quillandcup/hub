/**
 * POST /api/admin/members/[id]/delete-empty-kajabi-contact: deletes a stray Kajabi contact holding an email,
 * but only a true leftover, checked on the server whatever the page said.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const fetchWithAttachments = vi.hoisted(() => vi.fn());
const deleteContact = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kajabi/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kajabi/client")>()),
  createKajabiClient: () => ({ fetchContactWithAttachments: fetchWithAttachments, deleteContact }),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";
import { POST } from "@/app/api/admin/members/[id]/delete-empty-kajabi-contact/route";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const EMPTY = { relationships: { tags: { data: [] }, offers: { data: [] }, customer: { data: null } } };
const contact = (email: string, extra: Record<string, unknown> = EMPTY) => ({ id: "dup1", type: "contacts", attributes: { email }, ...extra });

async function post(body: unknown, id = ME) {
  const response = await POST(
    new NextRequest(`http://localhost/api/admin/members/${id}/delete-empty-kajabi-contact`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  fetchWithAttachments.mockReset().mockResolvedValue(contact("new@example.com"));
  deleteContact.mockReset().mockResolvedValue(undefined);
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" }, forbidden: false, supabase: {} } as never);
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ME, name: "Ada Example", email: "ada@example.com", kajabiId: "kaj1" },
        { id: OTHER, name: "Grace Example", email: "grace@example.com", kajabiId: "kaj-grace" },
      ],
      kajabiContacts: [{ kajabi_contact_id: "dup1", email: "new@example.com", name: "Dup", data: {}, imported_at: "2026-01-01T00:00:00Z" } as never],
    })
  );
});

describe("deleting an empty duplicate Kajabi contact", () => {
  it("deletes it in Kajabi and in the Bronze copy when it is a true leftover", async () => {
    expect(await post({ contactId: "dup1", email: "New@Example.com" })).toEqual({ status: 200, body: { ok: true } });

    expect(deleteContact).toHaveBeenCalledWith("dup1");
    expect(await repos.billing.kajabiContactsByEmail("new@example.com")).toEqual([]);
  });

  it("refuses without an admin, and for a malformed request", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ user: null } as never);
    expect((await post({ contactId: "dup1", email: "new@example.com" })).status).toBe(401);
    vi.mocked(requireAdmin).mockResolvedValueOnce({ user: { id: "x" }, forbidden: true } as never);
    expect((await post({ contactId: "dup1", email: "new@example.com" })).status).toBe(403);

    expect((await post("{not json")).status).toBe(400);
    expect((await post({ contactId: "", email: "new@example.com" })).status).toBe(400);
    expect((await post({ contactId: "dup1", email: "nope" })).status).toBe(400);
    expect((await post({ contactId: "dup1", email: "new@example.com" }, "mbr_missing")).status).toBe(404);
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it("never deletes the member's own contact or one linked to any member", async () => {
    expect((await post({ contactId: "kaj1", email: "new@example.com" })).status).toBe(400);
    expect((await post({ contactId: "kaj-grace", email: "new@example.com" })).status).toBe(409);
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it("never deletes a contact that has something attached, or doesn't have the email in Kajabi now", async () => {
    fetchWithAttachments.mockResolvedValue(contact("new@example.com", { links: { customer: "https://app.kajabi.com/api/v1/customers/1" }, relationships: EMPTY.relationships }));
    expect(await post({ contactId: "dup1", email: "new@example.com" })).toMatchObject({ status: 409, body: { error: expect.stringContaining("customer record, tags or offers") } });

    fetchWithAttachments.mockResolvedValue(contact("someone.else@example.com"));
    expect(await post({ contactId: "dup1", email: "new@example.com" })).toMatchObject({ status: 409, body: { error: expect.stringContaining("doesn't have that email") } });

    fetchWithAttachments.mockResolvedValue(contact("new@example.com", {}));
    expect((await post({ contactId: "dup1", email: "new@example.com" })).status).toBe(409);
    expect(deleteContact).not.toHaveBeenCalled();
    expect(await repos.billing.kajabiContactsByEmail("new@example.com")).toHaveLength(1);
  });

  it("passes on a Kajabi failure, and still succeeds when only the Bronze cleanup fails", async () => {
    fetchWithAttachments.mockRejectedValueOnce(new Error("Kajabi is down"));
    expect(await post({ contactId: "dup1", email: "new@example.com" })).toEqual({ status: 502, body: { error: "Kajabi is down" } });

    deleteContact.mockRejectedValueOnce(new Error("Kajabi refused"));
    expect(await post({ contactId: "dup1", email: "new@example.com" })).toEqual({ status: 502, body: { error: "Kajabi refused" } });
    expect(await repos.billing.kajabiContactsByEmail("new@example.com")).toHaveLength(1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.billing, "deleteKajabiContact").mockRejectedValueOnce(new Error("db down"));
    expect(await post({ contactId: "dup1", email: "new@example.com" })).toEqual({ status: 200, body: { ok: true } });
  });
});
