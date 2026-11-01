// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { uploadCover } from "../helpers/cover-upload";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  updateProjectDetails: vi.fn(),
  setStartingBalances: vi.fn(),
  updateProjectCover: vi.fn(),
  deleteProject: vi.fn(),
}));

import ProjectDetailsModal from "@/components/writing/ProjectDetailsModal";
import { deleteProject, updateProjectCover } from "@/app/(member)/projects/actions";

const PROJECT = { id: "wprj_AAAAAAAAAAA1", title: "My Novel", description: null, coverUrl: null, startingBalances: {} } as never;
const URL_ = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";

beforeEach(() => {
  vi.mocked(updateProjectCover).mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("?") ? { assets: [] } : { url: URL_, assetId: "media_AAAAAAAAAAA1", width: 1600, height: 2560 }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const upload = () => uploadCover(new File([new Uint8Array(10)], "cover.png", { type: "image/png" }));

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

describe("ProjectDetailsModal delete", () => {
  const originalLocation = window.location;
  beforeEach(() => {
    vi.mocked(deleteProject).mockReset();
    Object.defineProperty(window, "location", { configurable: true, value: { href: "/projects/wprj_AAAAAAAAAAA1" } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("asks first, and deletes nothing when declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={PROJECT} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("My Novel"));
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("deletes after confirming and goes back to My Writing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(deleteProject).mockResolvedValue({ success: true });
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={PROJECT} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(deleteProject).toHaveBeenCalledWith("wprj_AAAAAAAAAAA1");
    await waitFor(() => expect(window.location.href).toBe("/projects"));
  });

  it("stays and says why when the delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(deleteProject).mockResolvedValue({ error: "Failed to delete project" });
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={PROJECT} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByText("Failed to delete project")).toBeInTheDocument();
    expect(window.location.href).toBe("/projects/wprj_AAAAAAAAAAA1");
    expect(screen.getByRole("button", { name: "Delete project" })).toBeEnabled();
  });

  it("says the book stays when the project has one", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const withBook = { ...(PROJECT as object), book: { id: "b1", title: "B" } } as never;
    render(<ProjectDetailsModal isOpen onClose={() => {}} onSaved={() => {}} project={withBook} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Book Shelf stays"));
  });
});
