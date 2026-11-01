// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import EventDetailClient from "@/app/(member)/events/[slug]/EventDetailClient";

const EVENT = {
  id: "e1",
  title: "Autumn Retreat",
  event_type: "in_person_retreat",
  location: "Cedar Lodge",
  starts_at: "2026-10-09",
  ends_at: "2026-10-11",
  focus: null,
  description: null,
  agenda: null,
  results: null,
  google_photos_album_url: null,
  guests_allowed: false,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: null,
};

const photos = [
  { id: "ph1", width: 800, height: 600 },
  { id: "ph2", width: 600, height: 800 },
];

describe("EventDetailClient photos", () => {
  it("says there are none yet", () => {
    render(<EventDetailClient event={EVENT} photos={[]} />);
    expect(screen.getByText("No photos yet.")).toBeInTheDocument();
  });

  it("shows each photo from the private proxy route, as a named control that opens it in the lightbox", async () => {
    const { container } = render(<EventDetailClient event={EVENT} photos={photos} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-track="event-open-photo"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[1].querySelector("img")).toHaveAttribute("src", "/api/events/e1/photos/ph2?w=480");

    await userEvent.click(buttons[1]);
    // The lightbox is open on the second photo: it offers the previous one and a close button.
    expect(screen.getByRole("button", { name: "Previous photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("EventDetailClient audience", () => {
  it("shows no audience line for a members-only event with no sign-up", () => {
    render(<EventDetailClient event={EVENT} photos={[]} />);
    expect(screen.queryByRole("list", { name: "Who it's for" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^With /)).not.toBeInTheDocument();
  });

  it("tells members who it's for, how to join, and who is speaking", () => {
    render(
      <EventDetailClient
        event={{ ...EVENT, guests_allowed: true, registration: "application", capacity: 7, selection: "selected", speakers: "Ada Example" }}
        photos={[]}
      />,
    );
    const list = screen.getByRole("list", { name: "Who it's for" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Guests welcome",
      "Application required",
      "7 places",
      "The hosts choose",
    ]);
    // The speaker is part of the name members read.
    expect(screen.getByRole("heading", { level: 1, name: "Autumn Retreat with Ada Example" })).toBeInTheDocument();
  });

  it("shows an event on a calendar prickle under its name, without the calendar's label and category, and keeps who it is with", () => {
    render(
      <EventDetailClient
        event={{ ...EVENT, title: "Quill & Cup [Authorpreneurship] Prickle: Meeting What Readers Want (at Book Events) with Fantasy Author Ada Example", speakers: "Ada Example" }}
        photos={[]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Meeting What Readers Want (at Book Events) with Fantasy Author Ada Example" })).toBeInTheDocument();
  });

  it("names the host in the heading when there is no guest speaker, and the speaker when there is", () => {
    const { unmount } = render(<EventDetailClient event={{ ...EVENT, title: "Progress Prickle", host_name: "Jenn Parker" }} photos={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Progress Prickle with Jenn P" })).toBeInTheDocument();
    unmount();

    render(<EventDetailClient event={{ ...EVENT, title: "Query Letters", speakers: "Sam Example", host_name: "Jenn Parker" }} photos={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Query Letters with Sam Example" })).toBeInTheDocument();
  });

  it("labels the new kinds of event", () => {
    render(<EventDetailClient event={{ ...EVENT, event_type: "book_launch" }} photos={[]} />);
    expect(screen.getByText("Book Launch")).toBeInTheDocument();
  });
});

describe("EventDetailClient location", () => {
  it("shows a place as typed", () => {
    render(<EventDetailClient event={EVENT} photos={[]} />);
    expect(screen.getByText(/Cedar Lodge/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join/ })).not.toBeInTheDocument();
  });

  it("shows a video call link as a Join control, not as the link itself", () => {
    const url = "https://us06web.zoom.us/j/87106462893?pwd=secret";
    render(<EventDetailClient event={{ ...EVENT, location: url }} photos={[]} />);

    const join = screen.getByRole("link", { name: "Join on Zoom" });
    expect(join).toHaveAttribute("href", url);
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/pwd=secret/)).not.toBeInTheDocument();
  });

  it("shows no location line when there is none", () => {
    render(<EventDetailClient event={{ ...EVENT, location: null }} photos={[]} />);
    expect(screen.queryByText(/Cedar Lodge/)).not.toBeInTheDocument();
  });
});


describe("EventDetailClient cover image", () => {
  it("shows the picked image above the title, with its alt text", () => {
    render(<EventDetailClient event={EVENT} photos={[]} coverImage={{ src: "/api/media/media_AAAAAAAAAAA1/event_hero", alt: "Cedar Lodge" }} />);
    const image = screen.getByAltText("Cedar Lodge");
    expect(image).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/event_hero");
    expect(image.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no image when there isn't one", () => {
    const { container } = render(<EventDetailClient event={EVENT} photos={[]} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
