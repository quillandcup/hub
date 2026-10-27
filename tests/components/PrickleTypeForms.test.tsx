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
  it("starts with every dimension off and sends the ones chosen", async () => {
    render(<NewPrickleTypeForm />);
    expect(screen.getByLabelText("Listed in Events")).not.toBeChecked();
    expect(screen.getByLabelText("Announced publicly")).not.toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).not.toBeChecked();

    await userEvent.type(screen.getByPlaceholderText(/Progress Prickle/), "Book Launch Party");
    await userEvent.click(screen.getByLabelText("Listed in Events"));
    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(sentBody()).toMatchObject({ name: "Book Launch Party", listedInEvents: true, announcedPublicly: false, guestsAllowed: true });
    expect(router.push).toHaveBeenCalledWith("/admin/data/prickle-types");
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
    announced_publicly: false,
    guests_allowed: true,
  };

  it("shows the saved dimensions and sends changes", async () => {
    render(<EditPrickleTypeForm prickleType={type} />);
    expect(screen.getByLabelText("Listed in Events")).toBeChecked();
    expect(screen.getByLabelText("Announced publicly")).not.toBeChecked();
    expect(screen.getByLabelText("Guests allowed")).toBeChecked();

    await userEvent.click(screen.getByLabelText("Listed in Events"));
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(sentBody()).toMatchObject({ typeId: type.id, listedInEvents: false, announcedPublicly: true, guestsAllowed: true });
  });
});
