// @vitest-environment jsdom
/**
 * Member directory (app/(member)/members/page.tsx): lists current members from the
 * get_member_directory RPC, searches them client-side, and folds in the viewer's own private
 * notes (never in sudo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeTables,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

import MemberDirectoryPage from "@/app/(member)/members/page";

const ROWS = [
  {
    id: "m-zoe",
    name: "Zoe Legalname",
    display_name: "Zoë Thornfield",
    photo_url: "javascript:alert(1)",
    bio: "Writes cozy mysteries with cats.",
    first_joined_at: "2024-02-01",
    projects: ["The Lantern Keeper"],
    topics: ["cozy mysteries", "querying agents"],
  },
  {
    id: "m-pat",
    name: "Pat Quill",
    display_name: null,
    photo_url: null,
    bio: null,
    first_joined_at: "2023-05-01",
    projects: [],
    topics: [],
  },
];

function tables(extra: FakeTables = {}): FakeTables {
  return { "rpc:get_member_directory": { data: ROWS }, ...extra };
}

const props = (q?: string) => ({ searchParams: Promise.resolve(q === undefined ? {} : { q }) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase(tables());
});

describe("member directory page", () => {
  it("lists members alphabetically by display name with projects and topics", async () => {
    await renderServerPage(MemberDirectoryPage, props());

    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Pat Quill", "Zoë Thornfield"]);
    expect(screen.getByRole("link", { name: "Zoë Thornfield" })).toHaveAttribute("href", "/members/m-zoe");
    expect(screen.getByText("The Lantern Keeper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "querying agents" })).toBeInTheDocument();
    expect(screen.getByText("2 Hedgies")).toBeInTheDocument();
    // Unsafe photo URLs are dropped (initials avatar instead).
    expect(document.querySelector('img[src^="javascript"]')).toBeNull();
  });

  it("filters as you type and by clicking a topic", async () => {
    await renderServerPage(MemberDirectoryPage, props());
    const search = screen.getByLabelText("Search members");

    await userEvent.type(search, "lantern");
    expect(screen.queryByRole("link", { name: "Pat Quill" })).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 Hedgies")).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.click(screen.getByRole("button", { name: "cozy mysteries" }));
    expect(search).toHaveValue("cozy mysteries");
    expect(screen.getByRole("link", { name: "Zoë Thornfield" })).toBeInTheDocument();
    expect(window.location.search).toBe("?q=cozy+mysteries");
  });

  it("starts from ?q= and offers to clear a search with no results", async () => {
    await renderServerPage(MemberDirectoryPage, props("dragons"));
    expect(screen.getByLabelText("Search members")).toHaveValue("dragons");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks and searches the viewer's own private notes", async () => {
    const supabase = useFakeSupabase(
      tables({ member_notes: { data: [{ subject_member_id: "m-pat", body: "loves sprint prickles" }] } })
    );
    await renderServerPage(MemberDirectoryPage, props("sprint"));

    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("link", { name: "Pat Quill" })).toBeInTheDocument();
    expect(within(item).getByLabelText("You have a private note about this member")).toBeInTheDocument();
    // The note body itself isn't printed in the directory.
    expect(screen.queryByText("loves sprint prickles")).not.toBeInTheDocument();
    const notesQuery = supabase.queries.find((q) => q.table === "member_notes");
    expect(notesQuery?.calls).toContainEqual({ method: "eq", args: ["author_member_id", MEMBER_IDENTITY.memberId] });
  });

  it("doesn't load notes in sudo mode", async () => {
    signInAs(ADMIN_USER, { ...MEMBER_IDENTITY, isSudo: true });
    const supabase = useFakeSupabase(tables());
    await renderServerPage(MemberDirectoryPage, props());
    expect(supabase.queries.some((q) => q.table === "member_notes")).toBe(false);
  });

  it("redirects a user with no effective member identity to /admin", async () => {
    signInAs(ADMIN_USER, null);
    await expectRedirect(MemberDirectoryPage, props(), "/admin");
  });
});
