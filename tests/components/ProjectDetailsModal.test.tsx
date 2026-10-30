// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  updateProjectDetails: vi.fn(),
  setStartingBalances: vi.fn(),
  updateProjectCover: vi.fn(),
}));

import ProjectDetailsModal from "@/components/writing/ProjectDetailsModal";
import { updateProjectCover } from "@/app/(member)/projects/actions";

const PROJECT = { id: "wprj_AAAAAAAAAAA1", title: "My Novel", description: null, coverUrl: null, startingBalances: {} } as never;
const URL_ = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";

beforeEach(() => {
  vi.mocked(updateProjectCover).mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: URL_, assetId: "media_AAAAAAAAAAA1", width: 1600, height: 2560 }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const upload = () => userEvent.upload(screen.getByLabelText("Cover image file"), new File([new Uint8Array(10)], "cover.png", { type: "image/png" }));

describe("ProjectDetailsModal cover", () => {
  it("saves an uploaded cover on the project straight away and shows it", async () => {
    vi.mocked(updateProjectCover).mockResolvedValue({ success: true });
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={PROJECT} />);
    await upload();
    await waitFor(() => expect(updateProjectCover).toHaveBeenCalledWith("wprj_AAAAAAAAAAA1", URL_));
    await waitFor(() => expect(screen.getByAltText("Cover preview")).toHaveAttribute("src", URL_));
    expect(screen.getByText(/1600 x 2560 px/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download for Amazon/ })).toBeInTheDocument();
  });

  it("keeps the old cover and says why when the project can't take the new one", async () => {
    vi.mocked(updateProjectCover).mockResolvedValue({ error: "That cover isn't one of yours: upload it again" });
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={PROJECT} />);
    await upload();
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't one of yours");
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();
  });
});
