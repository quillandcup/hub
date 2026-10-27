// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventDetailsCard, { type EventData } from "@/app/(admin)/admin/events/[id]/EventDetailsCard";

const EVENT: EventData = {
  id: "evt_AAAAAAAAAAA1",
  slug: "retreat",
  title: "Spring Retreat",
  event_type: "in_person_retreat",
  location: "Cedar Lodge",
  starts_at: "2097-04-01",
  ends_at: "2097-04-03",
  focus: null,
  description: "A weekend away",
  agenda: null,
  results: null,
  google_photos_album_url: null,
  announced_publicly: false,
  guests_allowed: false,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: null,
  calendar_event_id: null,
  overridden_fields: [],
  deleted_at: null,
};

const onSave = vi.fn();
const onToggleRemoved = vi.fn();
const onRevert = vi.fn();

function renderCard(event: Partial<EventData> = {}, prickleId: string | null = null) {
  return render(
    <EventDetailsCard
      event={{ ...EVENT, ...event }}
      prickleId={prickleId}
      onSave={onSave}
      onToggleRemoved={onToggleRemoved}
      removing={false}
      onRevert={onRevert}
      reverting={false}
    />,
  );
}

beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue(null);
  onToggleRemoved.mockReset();
  onRevert.mockReset();
});
afterEach(cleanup);

describe("EventDetailsCard view", () => {
  it("shows what the event has and leaves out what it hasn't", () => {
    renderCard();

    expect(screen.getByText("Spring Retreat")).toBeInTheDocument();
    expect(screen.getByText("In-Person Retreat")).toBeInTheDocument();
    expect(screen.getByText("Cedar Lodge")).toBeInTheDocument();
    expect(screen.getByText("A weekend away")).toBeInTheDocument();
    expect(screen.getByText("Members, no sign-up")).toBeInTheDocument();
    for (const empty of ["Agenda", "Results", "Focus", "Guest speakers", "Google Photos album"]) expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("has no notice for an event made in the Hub", () => {
    renderCard();
    expect(screen.queryByText(/Follows the shared calendar/)).not.toBeInTheDocument();
  });

  it("offers to remove an event from Events, and to add a removed one back, saying what removing did", async () => {
    const { unmount } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Remove from Events" }));
    expect(onToggleRemoved).toHaveBeenCalledTimes(1);
    unmount();

    renderCard({ deleted_at: "2097-01-01T00:00:00Z", calendar_event_id: "00000000-0000-4000-8000-00000000000a" });
    expect(screen.getByText(/Removed from Events: members don't see it/)).toBeInTheDocument();
    expect(screen.getByText(/The calendar sync leaves it removed\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add back to Events" })).toBeInTheDocument();
  });
});

describe("EventDetailsCard edit", () => {
  it("turns each value into its field in place, including the ones that are empty, with Save and Cancel", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Spring Retreat");
    expect(screen.getByLabelText("Type")).toHaveValue("in_person_retreat");
    expect(screen.getByLabelText("Starts")).toHaveValue("2097-04-01");
    expect(screen.getByLabelText("Ends")).toHaveValue("2097-04-03");
    expect(screen.getByLabelText("Location")).toHaveValue("Cedar Lodge");
    expect(screen.getByLabelText("Description")).toHaveValue("A weekend away");
    for (const emptyField of ["Focus", "Agenda", "Results", "Google Photos album"]) expect(screen.getByLabelText(emptyField)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("saves the form, and closes when it saved", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Fall Retreat");
    await userEvent.type(screen.getByLabelText("Agenda"), "Friday arrival");
    await userEvent.click(screen.getByLabelText("Announced publicly"));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Fall Retreat", agenda: "Friday arrival", announced_publicly: true, location: "Cedar Lodge" }));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves a change to every field, each in its own place", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.selectOptions(screen.getByLabelText("Type"), "workshop");
    await userEvent.clear(screen.getByLabelText("Starts"));
    await userEvent.type(screen.getByLabelText("Starts"), "2097-05-01");
    await userEvent.clear(screen.getByLabelText("Ends"));
    await userEvent.type(screen.getByLabelText("Ends"), "2097-05-02");
    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.type(screen.getByLabelText("Location"), "Room 9");
    await userEvent.type(screen.getByLabelText("Focus"), "Deep drafting");
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "New words");
    await userEvent.type(screen.getByLabelText("Agenda"), "Friday arrival");
    await userEvent.type(screen.getByLabelText("Results"), "Ten chapters");
    await userEvent.type(screen.getByLabelText("Google Photos album"), "https://photos.example.test/album");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "workshop",
        starts_at: "2097-05-01",
        ends_at: "2097-05-02",
        location: "Room 9",
        focus: "Deep drafting",
        description: "New words",
        agenda: "Friday arrival",
        results: "Ten chapters",
        google_photos_album_url: "https://photos.example.test/album",
      }),
    );
  });

  it("turns an emptied field back into none, not an empty string", async () => {
    renderCard({ location: "Cedar Lodge", focus: "Deep drafting" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.clear(screen.getByLabelText("Focus"));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ location: null, focus: null }));
  });

  it("shows the album, agenda and results as text when there are some, the album as a link", () => {
    renderCard({ agenda: "Friday arrival", results: "Ten chapters", google_photos_album_url: "https://photos.example.test/album", focus: "Deep drafting" });

    expect(screen.getByText("Friday arrival")).toBeInTheDocument();
    expect(screen.getByText("Ten chapters")).toBeInTheDocument();
    expect(screen.getByText("Deep drafting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://photos.example.test/album" })).toHaveAttribute("href", "https://photos.example.test/album");
  });

  it("stays open, showing why, when saving fails", async () => {
    onSave.mockResolvedValue("Missing required fields");
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Missing required fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("goes back to the text on Cancel, saving nothing, and starts clean the next time", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Title"), " changed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Spring Retreat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Spring Retreat");
  });
});

describe("EventDetailsCard for an event that follows the calendar", () => {
  const CAL = "00000000-0000-4000-8000-00000000000a";

  it("says in one notice what follows the calendar, locks the dates, and offers to follow it again once something is changed", async () => {
    renderCard({ calendar_event_id: CAL, overridden_fields: ["location"] });

    expect(screen.getByText(/Follows the shared calendar: dates and times come from it, and you changed the location\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Follow the calendar again" }));
    expect(onRevert).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Starts")).toBeDisabled();
    expect(screen.getByLabelText("Ends")).toBeDisabled();
  });

  it("says the title, description and location follow the calendar until changed, with no button yet", () => {
    renderCard({ calendar_event_id: CAL });

    expect(screen.getByText(/the title, description and location do too until you change them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow the calendar again" })).not.toBeInTheDocument();
  });

  it("locks the title, description and guest speaker of an event that stands for a prickle, and links to it in the same notice", async () => {
    renderCard({ calendar_event_id: CAL, speakers: "Ada Example" }, "prkl_AAAAAAAAAAA1");

    expect(screen.getByRole("link", { name: "edit them on the prickle" })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
    expect(screen.getAllByText(/Follows the shared calendar/)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Guest speakers")).toBeDisabled();
    expect(screen.getByLabelText("Location")).toBeEnabled();
  });
});
