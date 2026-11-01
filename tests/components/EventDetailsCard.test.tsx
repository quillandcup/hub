// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/media/MediaPicker", () => ({
  default: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <div>
      <span data-testid="picker-value">{value ?? "none"}</span>
      <button type="button" onClick={() => onChange("media_BBBBBBBBBBB2")}>
        pick
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear
      </button>
    </div>
  ),
}));

import EventDetailsCard, { type EventData, type EventOverrides } from "@/app/(admin)/admin/events/[slug]/EventDetailsCard";

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
  image_id: null,
  announced_publicly: false,
  guests_allowed: false,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: null,
  host_name: null,
  host_id: null,
  start_time: "2097-04-01T04:00:00Z",
  end_time: "2097-04-04T04:00:00Z",
  deleted_at: null,
};

const onSave = vi.fn();
const onToggleRemoved = vi.fn();

const NOT_EDITED: EventOverrides = { title: false, description: false, guestSpeaker: false, location: false };
const MEMBERS = [{ id: "mbr_AAAAAAAAAAA1", name: "Pat Example", displayName: "Pat", email: "pat@example.com" }];

function renderCard(event: Partial<EventData> = {}, { hubSession = true, prickleId = "prkl_AAAAAAAAAAA1", overridden = NOT_EDITED } = {}) {
  return render(
    <EventDetailsCard
      event={{ ...EVENT, ...event }}
      prickleId={prickleId}
      hubSession={hubSession}
      members={MEMBERS}
      overridden={overridden}
      onSave={onSave}
      onToggleRemoved={onToggleRemoved}
      removing={false}
    />,
  );
}

beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue(null);
  onToggleRemoved.mockReset();
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
    expect(screen.queryByText(/Stands on a calendar prickle|stands on a calendar prickle/)).not.toBeInTheDocument();
  });

  it("offers to remove an event from Events, and to add a removed one back, saying what removing did", async () => {
    const { unmount } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Remove from Events" }));
    expect(onToggleRemoved).toHaveBeenCalledTimes(1);
    unmount();

    renderCard({ deleted_at: "2097-01-01T00:00:00Z" }, { hubSession: false });
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

describe("EventDetailsCard for an event on a calendar prickle", () => {
  const calendar = (event: Partial<EventData> = {}, overridden: EventOverrides = NOT_EDITED) =>
    renderCard({ speakers: "Ada Example", host_name: "Fern Example", host_id: "mbr_FERN00000001", ...event }, { hubSession: false, overridden });

  it("has no redirect notice, only a secondary link to the prickle", () => {
    calendar();

    expect(screen.queryByText(/It stands on a calendar prickle/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit them on the prickle" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View prickle" })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
  });

  it("edits the title, description, host, guest speaker and location here, and keeps the times read-only with a note", async () => {
    calendar({ start_time: "2097-04-01T14:00:00Z", end_time: "2097-04-01T15:30:00Z", ends_at: "2097-04-01" });
    expect(screen.getByText("10:00 – 11:30 Eastern")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByLabelText("Description")).toBeEnabled();
    expect(screen.getByLabelText("Location")).toBeEnabled();
    expect(screen.getByLabelText("Guest speakers")).toBeEnabled();
    expect(screen.getByText("Fern Example")).toBeInTheDocument();
    for (const time of ["Starts", "Ends", "Start time", "End time"]) expect(screen.queryByLabelText(time)).not.toBeInTheDocument();
    expect(screen.getByText(/come from Google Calendar and can't be changed here yet/)).toBeInTheDocument();
    expect(screen.getByText("10:00 – 11:30 Eastern")).toBeInTheDocument();
  });

  it("sends the edited text and the picked host", async () => {
    calendar();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Renamed");
    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.type(screen.getByLabelText("Location"), "Room 9");
    await userEvent.type(screen.getByLabelText("Focus"), "Craft");
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    await userEvent.type(screen.getByPlaceholderText("Search for the host..."), "Pat");
    await userEvent.click(await screen.findByText("Pat"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed", location: "Room 9", focus: "Craft", host_id: "mbr_AAAAAAAAAAA1" }));
  });

  it("marks what was set by hand and gives it back to the calendar on Save", async () => {
    calendar({}, { title: true, description: false, guestSpeaker: true, location: false });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getAllByText("(edited)")).toHaveLength(2);
    const again = screen.getAllByRole("button", { name: "Follow the calendar again" });
    expect(again).toHaveLength(2);
    await userEvent.click(again[0]);
    expect(screen.getByLabelText("Title")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "" }));
  });

  it("shows no edited markers for an event made in the Hub", async () => {
    renderCard({}, { hubSession: true, overridden: { title: true, description: true, guestSpeaker: true, location: true } });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow the calendar again" })).not.toBeInTheDocument();
  });
});

describe("EventDetailsCard for an event made in the Hub", () => {
  it("edits the host, the times and the dates in place; an event with no times is all day", async () => {
    renderCard();
    expect(screen.queryByText(/Eastern/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Starts")).toHaveValue("2097-04-01");
    expect(screen.getByLabelText("Ends")).toHaveValue("2097-04-03");
    expect(screen.getByLabelText("Start time")).toHaveValue("");
    expect(screen.getByLabelText("End time")).toHaveValue("");

    await userEvent.type(screen.getByLabelText("Host"), "Fern Example");
    await userEvent.type(screen.getByLabelText("Start time"), "10:00");
    await userEvent.type(screen.getByLabelText("End time"), "11:30");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ host_name: "Fern Example", start_clock: "10:00", end_clock: "11:30", starts_at: "2097-04-01", ends_at: "2097-04-03" }));
  });

  it("opens a timed event with its Eastern times", async () => {
    renderCard({ start_time: "2097-04-01T14:00:00Z", end_time: "2097-04-01T15:30:00Z", ends_at: "2097-04-01" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Start time")).toHaveValue("10:00");
    expect(screen.getByLabelText("End time")).toHaveValue("11:30");
    expect(screen.getByLabelText("Guest speakers")).toBeEnabled();
  });
});

describe("EventDetailsCard cover image", () => {
  it("shows the chosen image in the view, and nothing when there is none", () => {
    renderCard({ image_id: "media_AAAAAAAAAAA1" });
    expect(screen.getByAltText("The event's cover")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/event_card");
    cleanup();
    renderCard();
    expect(screen.queryByText("Cover image")).not.toBeInTheDocument();
  });

  it("picks, changes and clears the image while editing, and saves it with the rest", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Cover image")).toBeInTheDocument();
    expect(screen.getByTestId("picker-value")).toHaveTextContent("none");

    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(screen.getByTestId("picker-value")).toHaveTextContent("media_BBBBBBBBBBB2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ image_id: "media_BBBBBBBBBBB2" }));

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ image_id: null }));
  });
});
