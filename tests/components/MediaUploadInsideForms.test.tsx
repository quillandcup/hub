// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import EventDetailsCard, { type EventData } from "@/app/(admin)/admin/events/[id]/EventDetailsCard";
import MediaUploadForm from "@/components/media/MediaUploadForm";

const EVENT: EventData = {
  id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Spring Retreat", event_type: "in_person_retreat", location: "Cedar Lodge",
  starts_at: "2097-04-01", ends_at: "2097-04-03", focus: null, description: null, agenda: null, results: null, google_photos_album_url: null,
  announced_publicly: false, guests_allowed: false, registration: "none", capacity: null, selection: "first_come", speakers: null,
  calendar_event_id: null, overridden_fields: [], deleted_at: null, image_id: null,
} as EventData;

const onSave = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onSave.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, status: 201, json: async () => ({ asset: { id: "media_AAAAAAAAAAA1" }, duplicate: false }) };
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
    render(<EventDetailsCard event={EVENT} prickleId={null} onSave={onSave} onToggleRemoved={vi.fn()} removing={false} onRevert={vi.fn()} reverting={false} />);
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

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("media_AAAAAAAAAAA1"));
    expect(outer).not.toHaveBeenCalled();
  });
});
