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
    expect(buttons[1].querySelector("img")).toHaveAttribute("src", "/api/events/e1/photos/ph2");

    await userEvent.click(buttons[1]);
    // The lightbox is open on the second photo: it offers the previous one and a close button.
    expect(screen.getByRole("button", { name: "Previous photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
