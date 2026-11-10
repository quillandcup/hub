// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MergeOwnedData from "@/app/(admin)/admin/members/MergeOwnedData";
import BulkMergeMemberModal from "@/app/(admin)/admin/members/BulkMergeMemberModal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DUP = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", display_name: "Penny Quill" };

function respond(url: string, body: unknown, ok = true) {
  return { ok, json: async () => body, url };
}

function mockFetch(ownedData: () => Promise<unknown>) {
  const fetchMock = vi.fn(async (url: string) => (url.includes("/owned-data") ? ownedData() : respond(url, { members: {} })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("MergeOwnedData", () => {
  it("warns about what would be deleted and lists what moves, naming the duplicate by display name with the legal name beside it", async () => {
    mockFetch(async () =>
      respond("/owned-data", {
        entries: [
          { table: "writing_projects", label: "Writing projects", count: 3, fate: "lost" },
          { table: "member_badges", label: "Badges", count: 2, fate: "moved" },
        ],
      }),
    );

    render(<MergeOwnedData member={DUP} keptName="Ada Example" />);

    expect(screen.getByText(/Counting/)).toBeTruthy();
    expect(await screen.findByText("Will be deleted, not moved:")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Writing projects");
    expect(screen.getByText("Badges")).toBeTruthy();
    expect(screen.getByText("Moves to Ada Example:")).toBeTruthy();
    expect(screen.getByText(/What Penny Quill has/)).toBeTruthy();
    expect(screen.getByText("(Fern Example)")).toBeTruthy();
  });

  it("says nothing would be lost when the duplicate owns only moved data", async () => {
    mockFetch(async () => respond("/owned-data", { entries: [{ table: "member_badges", label: "Badges", count: 1, fate: "moved" }] }));

    render(<MergeOwnedData member={{ id: DUP.id, name: "Fern Example" }} keptName="Ada Example" />);

    expect(await screen.findByText("Nothing here would be lost.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Badges")).toBeTruthy();
  });

  it("says nothing would be lost for a member who owns nothing", async () => {
    mockFetch(async () => respond("/owned-data", { entries: [] }));

    render(<MergeOwnedData member={{ id: DUP.id, name: "Fern Example" }} keptName="Ada Example" />);

    expect(await screen.findByText("Nothing here would be lost.")).toBeTruthy();
    expect(screen.queryByText(/Moves to/)).toBeNull();
  });

  it("shows an error, not an alarm, when the count fails", async () => {
    mockFetch(async () => respond("/owned-data", { error: "x" }, false));

    render(<MergeOwnedData member={DUP} keptName="Ada Example" />);

    expect(await screen.findByText(/Could not count what Penny Quill has/)).toBeTruthy();
    expect(screen.queryByText("Nothing here would be lost.")).toBeNull();
  });
});

describe("the merge dialog", () => {
  it("shows the duplicate's data and keeps the merge button enabled while it loads", async () => {
    const fetchMock = mockFetch(() => new Promise(() => {}));
    const members = [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" },
      { ...DUP, email: "fern@example.com" },
    ];

    render(<BulkMergeMemberModal members={members} isOpen onClose={() => {}} />);

    expect(await screen.findByText(/What Penny Quill has/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/members/${DUP.id}/owned-data`);
    expect((screen.getByRole("button", { name: /Merge & Delete/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
