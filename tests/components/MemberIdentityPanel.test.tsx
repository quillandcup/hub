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
        email="edy@example.com"
        emailAliases={[]}
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
      <MemberIdentityPanel
        memberId="member-1"
        name="Edy Hackett"
        displayName={null}
        hasKajabiId={true}
        email="edy@example.com"
        emailAliases={[]}
        nameAliases={[]}
      />
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
        email="edy@example.com"
        emailAliases={[]}
        nameAliases={aliases}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Use Edy Hackett as the default pen name" }));

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
        email="edy@example.com"
        emailAliases={[]}
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
      <MemberIdentityPanel
        memberId="member-1"
        name="Erica Haraldsen"
        displayName={null}
        hasKajabiId={true}
        email="edy@example.com"
        emailAliases={[]}
        nameAliases={[]}
      />
    );

    const input = screen.getByPlaceholderText("e.g. River Wilde");
    await userEvent.type(input, "River Wilde");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ newPenName: "River Wilde" });
  });

  it("removes a pen name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberIdentityPanel
        memberId="member-1"
        name="Erica Haraldsen"
        displayName={null}
        hasKajabiId={true}
        email="edy@example.com"
        emailAliases={[]}
        nameAliases={aliases}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove pen name Edy Hackett" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/aliases/alias-1", expect.objectContaining({ method: "DELETE" }))
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  const emailAliases = [
    { id: "ea-1", alias_email: "old@example.com", source: "auto_detected", active: true },
    { id: "ea-2", alias_email: "zoom@example.com", source: "manual", active: false },
  ];

  function renderWithEmails(props: Partial<React.ComponentProps<typeof MemberIdentityPanel>> = {}) {
    return render(
      <MemberIdentityPanel
        memberId="member-1"
        name="Erica Haraldsen"
        displayName={null}
        hasKajabiId={true}
        email="erica@example.com"
        emailAliases={emailAliases}
        nameAliases={[]}
        {...props}
      />
    );
  }

  function okFetch(data: Record<string, unknown> = {}) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows the member's email and their other emails with source and state", () => {
    renderWithEmails();

    expect(screen.getByDisplayValue("erica@example.com")).toBeInTheDocument();
    expect(screen.getByText("old@example.com")).toBeInTheDocument();
    expect(screen.getByText(/previous email/)).toBeInTheDocument();
    expect(screen.getByText(/inactive/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate old@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate zoom@example.com" })).toBeInTheDocument();
  });

  it("says whether an email change goes to Kajabi", () => {
    const { unmount } = renderWithEmails();
    expect(screen.getByText(/updates the contact's email in Kajabi/)).toBeInTheDocument();
    unmount();
    renderWithEmails({ hasKajabiId: false });
    expect(screen.getByText(/the email updates locally only/)).toBeInTheDocument();
  });

  it("changes the primary email", async () => {
    const fetchMock = okFetch();
    renderWithEmails();

    const saveEmail = screen.getByRole("button", { name: "Save email" });
    expect(saveEmail).toBeDisabled();

    const input = screen.getByDisplayValue("erica@example.com");
    await userEvent.clear(input);
    await userEvent.type(input, "erica.new@example.com");
    await userEvent.click(saveEmail);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "erica.new@example.com" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("treats a case-only change as no change", async () => {
    renderWithEmails();
    const input = screen.getByDisplayValue("erica@example.com");
    await userEvent.clear(input);
    await userEvent.type(input, "Erica@Example.com");
    expect(screen.getByRole("button", { name: "Save email" })).toBeDisabled();
  });

  it("adds another email", async () => {
    const fetchMock = okFetch();
    renderWithEmails();

    await userEvent.type(screen.getByRole("textbox", { name: "Add another email" }), "pen@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add email" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ newEmailAlias: "pen@example.com" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("deactivates and reactivates other emails", async () => {
    const fetchMock = okFetch();
    renderWithEmails();

    await userEvent.click(screen.getByRole("button", { name: "Deactivate old@example.com" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ emailAlias: { id: "ea-1", active: false } });

    await userEvent.click(screen.getByRole("button", { name: "Reactivate zoom@example.com" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ emailAlias: { id: "ea-2", active: true } });
  });

  it("links to the other member when the email is already theirs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "Another member already has that email. If they're the same person, merge them instead.",
          conflictingMemberId: "member-2",
        }),
      })
    );
    renderWithEmails();

    await userEvent.type(screen.getByRole("textbox", { name: "Add another email" }), "taken@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add email" }));

    expect(await screen.findByText(/merge them instead/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View that member" })).toHaveAttribute("href", "/admin/members/member-2");
    expect(refresh).not.toHaveBeenCalled();
  });
});
