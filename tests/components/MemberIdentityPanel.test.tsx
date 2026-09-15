// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberIdentityPanel from "@/app/(admin)/admin/members/[id]/MemberIdentityPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh }),
}));

const aliases = [{ id: "alias-1", alias: "Edy Hackett", source: "admin", active: true }];

beforeEach(() => {
  refresh.mockReset();
  vi.restoreAllMocks();
});

describe("MemberIdentityPanel", () => {
  it("saves the legal name with the keep-as-pen-name checkbox on by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ member: { name: "Erica Haraldsen", display_name: "Edy Hackett" }, aliases }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberIdentityPanel
        memberId="member-1"
        name="Edy Hackett"
        displayName={null}
        hasKajabiId={true}
        nameAliases={[]}
      />
    );

    const input = screen.getByDisplayValue("Edy Hackett");
    await userEvent.clear(input);
    await userEvent.type(input, "Erica Haraldsen");

    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/members/member-1",
        expect.objectContaining({ method: "PATCH" })
      )
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ name: "Erica Haraldsen", keepOldNameAsPenName: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows an error and does not refresh when the Kajabi push fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Kajabi is down" }) })
    );

    render(
      <MemberIdentityPanel memberId="member-1" name="Edy Hackett" displayName={null} hasKajabiId={true} nameAliases={[]} />
    );

    const input = screen.getByDisplayValue("Edy Hackett");
    await userEvent.clear(input);
    await userEvent.type(input, "Erica Haraldsen");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Kajabi is down")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sets a pen name as the default display name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ member: { name: "Erica Haraldsen", display_name: "Edy Hackett" }, aliases }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberIdentityPanel
        memberId="member-1"
        name="Erica Haraldsen"
        displayName={null}
        hasKajabiId={true}
        nameAliases={aliases}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Edy Hackett/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/members/member-1",
        expect.objectContaining({ method: "PATCH" })
      )
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ displayName: "Edy Hackett" });
  });

  it("clears the default pen name via 'Use legal name instead'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ member: { name: "Erica Haraldsen", display_name: null }, aliases }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberIdentityPanel
        memberId="member-1"
        name="Erica Haraldsen"
        displayName="Edy Hackett"
        hasKajabiId={true}
        nameAliases={aliases}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Use legal name instead" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ displayName: null });
  });

  it("adds a new pen name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ member: { name: "Erica Haraldsen", display_name: null }, aliases }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberIdentityPanel memberId="member-1" name="Erica Haraldsen" displayName={null} hasKajabiId={true} nameAliases={[]} />
    );

    const input = screen.getByPlaceholderText("e.g. River Wilde");
    await userEvent.type(input, "River Wilde");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ newPenName: "River Wilde" });
  });
});
