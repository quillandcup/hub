// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import NewPrickleTypeForm from "@/app/(admin)/admin/data/prickle-types/new/NewPrickleTypeForm";
import EditPrickleTypeForm from "@/app/(admin)/admin/data/prickle-types/[id]/edit/EditPrickleTypeForm";

const fetchMock = vi.fn();

beforeEach(() => {
  router.push.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("NewPrickleTypeForm dimensions", () => {
  it("starts with every dimension off, greys out each until the one before it is checked, and sends the ones chosen", async () => {
    render(<NewPrickleTypeForm />);
    expect(screen.getByLabelText("Listed in Events")).not.toBeChecked();
    expect(screen.getByLabelText("Announced publicly")).toBeDisabled();
    expect(screen.getByLabelText("Guests allowed")).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/Progress Prickle/), "Book Launch Party");
    await userEvent.click(screen.getByLabelText("Listed in Events"));
    expect(screen.getByLabelText("Announced publicly")).toBeEnabled();
    expect(screen.getByLabelText("Guests allowed")).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    expect(screen.getByLabelText("Guests allowed")).toBeEnabled();
    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(sentBody()).toMatchObject({ name: "Book Launch Party", listedInEvents: true, announcedPublicly: true, guestsAllowed: true });
    expect(router.push).toHaveBeenCalledWith("/admin/data/prickle-types");
  });

  it("unchecking one unchecks what depended on it", async () => {
    render(<NewPrickleTypeForm />);
    await userEvent.click(screen.getByLabelText("Listed in Events"));
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.click(screen.getByLabelText("Guests allowed"));

    await userEvent.click(screen.getByLabelText("Announced publicly"));
    expect(screen.getByLabelText("Guests allowed")).not.toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.click(screen.getByLabelText("Listed in Events"));
    expect(screen.getByLabelText("Announced publicly")).not.toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).not.toBeChecked();
  });
});

describe("EditPrickleTypeForm dimensions", () => {
  const type = {
    id: "prty_AAAAAAAAAAA1",
    name: "Pitch Prickle",
    normalized_name: "pitch",
    description: null,
    purpose: "writing" as const,
    solo_task_friendly: false,
    listed_in_events: true,
    announced_publicly: true,
    guests_allowed: false,
  };

  it("shows the saved dimensions and sends changes", async () => {
    render(<EditPrickleTypeForm prickleType={type} />);
    expect(screen.getByLabelText("Listed in Events")).toBeChecked();
    expect(screen.getByLabelText("Announced publicly")).toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).not.toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).toBeEnabled();

    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(sentBody()).toMatchObject({ typeId: type.id, listedInEvents: true, announcedPublicly: true, guestsAllowed: true });
  });

  it("takes everything after Listed in Events away when it is unchecked", async () => {
    render(<EditPrickleTypeForm prickleType={{ ...type, guests_allowed: true }} />);

    await userEvent.click(screen.getByLabelText("Listed in Events"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(sentBody()).toMatchObject({ listedInEvents: false, announcedPublicly: false, guestsAllowed: false });
  });
});
