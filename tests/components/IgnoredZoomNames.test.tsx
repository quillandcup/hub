// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import IgnoredZoomNames from "@/app/(admin)/admin/prickles/[id]/IgnoredZoomNames";

const PRICKLE_ID = "prkl_AAAAAAAAAAA1";
const items = [
  { zoomName: "iPhone", reason: "a guest" },
  { zoomName: "Tablet", reason: null },
];

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as any;
});

describe("IgnoredZoomNames", () => {
  it("renders nothing when no name is ignored here", () => {
    const { container } = render(<IgnoredZoomNames prickleId={PRICKLE_ID} items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each name with its reason when there is one", () => {
    render(<IgnoredZoomNames prickleId={PRICKLE_ID} items={items} />);
    expect(screen.getByText(/a guest/)).toBeInTheDocument();
    expect(screen.getByText(/Tablet/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
  });

  it("undo removes only this prickle's ignore and refreshes the page", async () => {
    render(<IgnoredZoomNames prickleId={PRICKLE_ID} items={items} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/zoom/ignore");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ zoomName: "iPhone", prickleId: PRICKLE_ID });
  });

  it("shows the error and doesn't refresh when undo fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) }) as any;
    render(<IgnoredZoomNames prickleId={PRICKLE_ID} items={items} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]);

    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
