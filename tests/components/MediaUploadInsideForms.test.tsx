// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import EventDetailsCard, { type EventData } from "@/app/(admin)/admin/events/[slug]/EventDetailsCard";
import MediaUploadForm from "@/components/media/MediaUploadForm";
import Modal from "@/components/Modal";

const EVENT: EventData = {
  id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Spring Retreat", event_type: "in_person_retreat", location: "Cedar Lodge",
  starts_at: "2097-04-01", ends_at: "2097-04-03", focus: null, description: null, agenda: null, results: null, google_photos_album_url: null,
  announced_publicly: false, guests_allowed: false, registration: "none", capacity: null, selection: "first_come", speakers: null,
  host_name: null, host_id: null, start_time: "2097-04-01T04:00:00Z", end_time: "2097-04-04T04:00:00Z", deleted_at: null, image_id: null,
} as EventData;

const onSave = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onSave.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, status: 201, json: async () => ({ asset: { id: "media_AAAAAAAAAAA1", width: 10, height: 10 }, duplicate: false }) };
    return { ok: true, json: async () => ({ assets: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("choosing a cover image while editing an event", () => {
  it("uploads the file and fills the picker, without saving the event behind the modal", async () => {
    render(<EventDetailsCard event={EVENT} prickleId="prkl_AAAAAAAAAAA1" hubSession members={[]} overridden={{ title: false, description: false, guestSpeaker: false, location: false }} onSave={onSave} onToggleRemoved={vi.fn()} removing={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: /Choose image/ }));
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "ronda.jpg", { type: "image/jpeg" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByAltText("The chosen image")).toBeInTheDocument();
    // Still editing: Save is there, and saving sends the new image.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ image_id: "media_AAAAAAAAAAA1" }));
  });

  it("does not submit a form it is inside of: uploading is not saving", async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onUploaded = vi.fn();
    render(
      <form onSubmit={outer}>
        <MediaUploadForm surface="event_cover" onUploaded={onUploaded} onError={vi.fn()} />
      </form>,
    );
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "ronda.jpg", { type: "image/jpeg" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("media_AAAAAAAAAAA1", expect.objectContaining({ id: "media_AAAAAAAAAAA1" })));
    expect(outer).not.toHaveBeenCalled();
  });

  it("is not a form of its own, so nothing it does can submit or navigate", () => {
    const { container } = render(<MediaUploadForm surface="event_cover" onUploaded={vi.fn()} onError={vi.fn()} />);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button[type=submit]")).toBeNull();
  });

  it("uploads on Enter in the title or tags field, without submitting the form around it", async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onUploaded = vi.fn();
    render(
      <form onSubmit={outer}>
        <MediaUploadForm surface="event_cover" onUploaded={onUploaded} onError={vi.fn()} />
      </form>,
    );
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "ronda.jpg", { type: "image/jpeg" }));
    await userEvent.type(screen.getByLabelText("Tags"), "ronda-spain{Enter}");

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("media_AAAAAAAAAAA1", expect.objectContaining({ id: "media_AAAAAAAAAAA1" })));
    expect(outer).not.toHaveBeenCalled();
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("does nothing on Enter before a file is chosen", async () => {
    render(<MediaUploadForm surface="event_cover" onUploaded={vi.fn()} onError={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Title"), "Ronda{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes a modal from a form without submitting the form", async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onClose = vi.fn();
    render(
      <form onSubmit={outer}>
        <Modal isOpen onClose={onClose} title="Choose an image">content</Modal>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });
});
