import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/lib/bookshelf-actions.test.ts's approach: these actions scope every
// read/write to effectiveIdentity.memberId (never a client-passed id), relying on RLS
// (member_id match OR is_admin()) to actually enforce it. These tests verify the
// app-level "not found"/validation handling and the query shape sent to Supabase.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateProjectDetails, updateProjectCover, setStartingBalances } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberEmail: "m1@example.com",
  isSudo: false,
};

function makeSupabaseMock({
  ownsProject = true,
  updateError,
  upsertError,
  deleteError,
}: {
  ownsProject?: boolean;
  updateError?: string;
  upsertError?: string;
  deleteError?: string;
} = {}) {
  const projectSelectSingle = vi
    .fn()
    .mockResolvedValue(ownsProject ? { data: { id: "project-1" }, error: null } : { data: null, error: null });
  const projectSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: projectSelectSingle })) })),
  }));

  const projectUpdateEq2 = vi
    .fn()
    .mockResolvedValue(updateError ? { error: { message: updateError } } : { error: null });
  const projectUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: projectUpdateEq2 })) }));

  const startingBalanceUpsert = vi
    .fn()
    .mockResolvedValue(upsertError ? { error: { message: upsertError } } : { error: null });

  const deleteIn = vi.fn().mockResolvedValue(deleteError ? { error: { message: deleteError } } : { error: null });
  const deleteEq2 = vi.fn(() => ({ in: deleteIn }));
  const deleteEq1 = vi.fn(() => ({ eq: deleteEq2 }));
  const startingBalanceDelete = vi.fn(() => ({ eq: deleteEq1 }));

  const from = vi.fn((table: string) => {
    if (table === "writing_projects") return { select: projectSelect, update: projectUpdate };
    if (table === "writing_project_starting_balances") return { upsert: startingBalanceUpsert, delete: startingBalanceDelete };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }) },
    from,
    __projectSelect: projectSelect,
    __projectUpdate: projectUpdate,
    __projectUpdateEq2: projectUpdateEq2,
    __upsert: startingBalanceUpsert,
    __deleteEq1: deleteEq1,
    __deleteIn: deleteIn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateProjectDetails", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateProjectDetails("project-1", { title: "New Title", description: "" });
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__projectUpdate).not.toHaveBeenCalled();
  });

  it("rejects a blank title before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateProjectDetails("project-1", { title: "   ", description: "" });
    expect(result).toEqual({ error: "Title is required" });
    expect(mock.__projectUpdate).not.toHaveBeenCalled();
  });

  it("trims title/description, scopes to the acting member, and revalidates", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateProjectDetails("project-1", { title: "  My Novel  ", description: "  A tale.  " });
    expect(result).toEqual({ success: true });
    expect(mock.__projectUpdate).toHaveBeenCalledWith({ title: "My Novel", description: "A tale." });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
  });

  it("stores a blank description as null", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateProjectDetails("project-1", { title: "My Novel", description: "   " });
    expect(mock.__projectUpdate).toHaveBeenCalledWith({ title: "My Novel", description: null });
  });

  it("surfaces an update error", async () => {
    const mock = makeSupabaseMock({ updateError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateProjectDetails("project-1", { title: "My Novel", description: "" });
    expect(result).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateProjectCover", () => {
  it("saves the cover URL scoped to the acting member", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateProjectCover("project-1", "https://example.com/cover.jpg");
    expect(result).toEqual({ success: true });
    expect(mock.__projectUpdate).toHaveBeenCalledWith({ cover_url: "https://example.com/cover.jpg" });
  });

  it("clears the cover when passed null", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateProjectCover("project-1", null);
    expect(mock.__projectUpdate).toHaveBeenCalledWith({ cover_url: null });
  });
});

describe("setStartingBalances", () => {
  it("reports 'Project not found' when the project isn't owned by the acting member", async () => {
    const mock = makeSupabaseMock({ ownsProject: false });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await setStartingBalances("project-1", { words: 1000 });
    expect(result).toEqual({ error: "Project not found" });
    expect(mock.__upsert).not.toHaveBeenCalled();
  });

  it("upserts measures with a positive amount and deletes the rest", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await setStartingBalances("project-1", { words: 5000, pages: 0 });
    expect(result).toEqual({ success: true });

    expect(mock.__upsert).toHaveBeenCalledWith(
      [{ project_id: "project-1", member_id: "member-1", measure: "words", amount: 5000 }],
      { onConflict: "project_id,measure" }
    );
    expect(mock.__deleteEq1).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.__deleteIn).toHaveBeenCalledWith("measure", [
      "time_minutes",
      "pages",
      "chapters",
      "scenes",
      "lines",
    ]);
  });

  it("only deletes (no upsert) when every measure is cleared", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await setStartingBalances("project-1", {});
    expect(result).toEqual({ success: true });
    expect(mock.__upsert).not.toHaveBeenCalled();
    expect(mock.__deleteIn).toHaveBeenCalledWith("measure", [
      "words",
      "time_minutes",
      "pages",
      "chapters",
      "scenes",
      "lines",
    ]);
  });

  it("surfaces an upsert error", async () => {
    const mock = makeSupabaseMock({ upsertError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await setStartingBalances("project-1", { words: 5000 });
    expect(result).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces a delete error", async () => {
    const mock = makeSupabaseMock({ deleteError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await setStartingBalances("project-1", { words: 5000 });
    expect(result).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
