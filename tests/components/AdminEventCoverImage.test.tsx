// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/media/MediaPicker", () => ({
  default: ({ value, onChange, disabled }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) => (
    <div>
      <span data-testid="picked">{value ?? "none"}</span>
      <button type="button" disabled={disabled} onClick={() => onChange("media_AAAAAAAAAAA1")}>
        pick image
      </button>
    </div>
  ),
}));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";

let posts: Record<string, unknown>[];

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ event: {} }) } as Response;
      }
      return { ok: true, json: async () => ({ events: [] }) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillAndSubmit(container: HTMLElement) {
  const [starts, ends] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  await userEvent.type(screen.getByPlaceholderText(/Virginia Retreat/), "Cover Test");
  await userEvent.type(starts, "2097-06-01");
  await userEvent.type(ends, "2097-06-01");
  await userEvent.click(screen.getByRole("button", { name: "Create Event" }));
  await waitFor(() => expect(posts).toHaveLength(1));
}

describe("the Add Event form's cover image", () => {
  it("sends the image picked from the library with the new event", async () => {
    const { container } = render(<EventsClient />);
    await userEvent.click(await screen.findByRole("button", { name: "Add Event" }));
    expect(screen.getByTestId("picked")).toHaveTextContent("none");
    await userEvent.click(screen.getByRole("button", { name: "pick image" }));
    await fillAndSubmit(container);
    expect(posts[0]).toMatchObject({ title: "Cover Test", image_id: "media_AAAAAAAAAAA1" });
  });

  it("sends no image when none was picked, and starts empty again for the next event", async () => {
    const { container } = render(<EventsClient />);
    await userEvent.click(await screen.findByRole("button", { name: "Add Event" }));
    await fillAndSubmit(container);
    expect(posts[0]).toMatchObject({ image_id: null });
  });
});
