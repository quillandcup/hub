// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import MediaLibraryClient from "@/app/(admin)/admin/media/MediaLibraryClient";

const ID = "media_AAAAAAAAAAA1";
const asset = (over: Record<string, unknown> = {}) => ({
  id: ID,
  title: "Hedgies on First",
  alt_text: "A hedgehog at a desk",
  tags: ["hedgies", "retreat"],
  is_public: false,
  updated_at: "2026-10-29T10:00:00Z",
  width: 1000,
  height: 500,
  mime_type: "image/png",
  focal_x: null,
  focal_y: null,
  fits: {},
  ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let library: ReturnType<typeof asset>[];
let detail: ReturnType<typeof asset>;
let usages: { kind: string; id: string; title: string }[];
let calls: { url: string; init?: RequestInit }[];
let respond: (url: string, init?: RequestInit) => Response | undefined;

beforeEach(() => {
  library = [asset(), asset({ id: "media_BBBBBBBBBBB2", title: "Retreat lodge", alt_text: null, tags: [], is_public: true })];
  detail = asset();
  usages = [];
  calls = [];
  respond = () => undefined;
  track.mockReset();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const custom = respond(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/media?")) {
      const q = (new URL(url, "http://x").searchParams.get("q") ?? "").toLowerCase();
      return json({ assets: library.filter((a) => a.title.toLowerCase().includes(q)) });
    }
    if (url === `/api/media/${ID}` && !init?.method) return json({ asset: detail, usages });
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The editor's picture of the whole image (the library's thumbnail has the same alt text). */
const wholePicture = () => screen.getAllByAltText("A hedgehog at a desk").find((img) => img.getAttribute("src")?.includes("/custom?"))!;
const patchCall = () => calls.find((c) => c.url === `/api/media/${ID}` && c.init?.method === "PATCH");

describe("MediaLibraryClient", () => {
  it("lists the library with each image's tags and whether it's public, and searches", async () => {
    render(<MediaLibraryClient />);
    expect(await screen.findByText("Hedgies on First")).toBeInTheDocument();
    expect(screen.getByText("hedgies, retreat")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByAltText("A hedgehog at a desk")).toHaveAttribute("src", `/api/media/${ID}/thumb?v=2026-10-29T10%3A00%3A00Z`);

    await userEvent.type(screen.getByRole("searchbox"), "lodge");
    await waitFor(() => expect(screen.queryByText("Hedgies on First")).not.toBeInTheDocument());
    expect(screen.getByText("Retreat lodge")).toBeInTheDocument();
  });

  it("says when the library is empty or a search finds nothing, and shows a load error", async () => {
    library = [];
    render(<MediaLibraryClient />);
    expect(await screen.findByText(/No images yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
    cleanup();

    respond = (url) => (url.startsWith("/api/media?") ? json({ error: "Forbidden" }, 403) : undefined);
    render(<MediaLibraryClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("uploads an image, then opens it to edit", async () => {
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ asset: { id: ID }, duplicate: false }, 201) : undefined);
    render(<MediaLibraryClient />);
    await screen.findByText("Hedgies on First");
    await userEvent.click(screen.getByRole("button", { name: "Upload image" }));
    await userEvent.upload(screen.getByLabelText("Image file"), new File([new Uint8Array(100)], "cover.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByLabelText("Title")).toHaveValue("Hedgies on First"); // the editor, loaded
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "admin_library", ok: true, converted: false, duplicate: false, large: false });
  });
});

describe("MediaEditor", () => {
  const open = async () => {
    render(<MediaLibraryClient />);
    await userEvent.click(await screen.findByText("Hedgies on First"));
    await screen.findByLabelText("Title");
  };

  it("shows the details, where it's used, the sizes, and the download links", async () => {
    usages = [{ kind: "event", id: "evt_AAAAAAAAAAA1", title: "Spring Retreat" }];
    await open();
    expect(screen.getByLabelText("Title")).toHaveValue("Hedgies on First");
    expect(screen.getByLabelText("Tags")).toHaveValue("hedgies, retreat");
    expect(screen.getByLabelText(/Alt text/)).toHaveValue("A hedgehog at a desk");
    expect(screen.getByText("1000 x 500 px · png")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Spring Retreat" })).toHaveAttribute("href", "/admin/events/evt_AAAAAAAAAAA1");
    // The whole picture, in its own shape (1000 x 500 -> 800 x 400), so a click maps to a point on it.
    expect(wholePicture()).toHaveAttribute("src", expect.stringContaining(`/custom?width=800&height=400&format=webp&fit=crop`));
    expect(screen.getByRole("link", { name: "The original" })).toHaveAttribute("href", `/api/media/${ID}/original?download=1`);
    expect(screen.getByRole("link", { name: /Amazon ebook cover/ })).toHaveAttribute("href", `/api/media/${ID}/book_cover_kdp_ebook?download=1`);
  });

  it("builds a custom-size download from the fields and records the clicks", async () => {
    await open();
    await userEvent.clear(screen.getByLabelText("Width"));
    await userEvent.type(screen.getByLabelText("Width"), "1234");
    await userEvent.clear(screen.getByLabelText("Height"));
    await userEvent.type(screen.getByLabelText("Height"), "567");
    await userEvent.selectOptions(screen.getByLabelText("Format"), "png");
    const link = screen.getByRole("link", { name: "Download this size" });
    expect(link).toHaveAttribute("href", `/api/media/${ID}/custom?width=1234&height=567&format=png&fit=crop&download=1`);
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(track).toHaveBeenCalledWith("media_downloaded", { kind: "custom" });
    const original = screen.getByRole("link", { name: "The original" });
    original.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(original);
    expect(track).toHaveBeenCalledWith("media_downloaded", { kind: "original" });
  });

  it("keeps a custom-size download inside what the route accepts, whatever is typed", async () => {
    await open();
    const link = screen.getByRole("link", { name: "Download this size" });
    await userEvent.clear(screen.getByLabelText("Width"));
    await userEvent.type(screen.getByLabelText("Width"), "99999");
    await userEvent.clear(screen.getByLabelText("Height"));
    await userEvent.type(screen.getByLabelText("Height"), "12.7");
    expect(link).toHaveAttribute("href", `/api/media/${ID}/custom?width=8000&height=12&format=jpeg&fit=crop&download=1`);
    await userEvent.clear(screen.getByLabelText("Height"));
    expect(link).toHaveAttribute("href", expect.stringContaining("height=1&"));
  });

  it("sets and clears the focal point with a click on the picture, and saves what changed", async () => {
    respond = (url, init) => (url === `/api/media/${ID}` && init?.method === "PATCH" ? json({ asset: { ...detail, title: "Renamed", tags: ["new"], focal_x: 0.25, focal_y: 0.5, is_public: true, updated_at: "2026-10-30T00:00:00Z" } }) : undefined);
    await open();
    const picture = wholePicture();
    vi.spyOn(picture, "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
    await userEvent.pointer({ target: picture, keys: "[MouseLeft]", coords: { clientX: 200, clientY: 150 } });
    expect(screen.getByTestId("focal-marker")).toHaveStyle({ left: "25%", top: "50%" });

    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Renamed");
    await userEvent.clear(screen.getByLabelText("Tags"));
    await userEvent.type(screen.getByLabelText("Tags"), "new");
    await userEvent.click(screen.getByLabelText(/Public:/));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCall()).toBeTruthy());
    expect(JSON.parse(patchCall()!.init!.body as string)).toEqual({ title: "Renamed", alt_text: "A hedgehog at a desk", tags: ["new"], is_public: true, focal: { x: 0.25, y: 0.5 } });
    expect(track).toHaveBeenCalledWith("media_edited", { title: true, alt: false, tags: true, focal: true, fit: false, is_public: true });
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Renamed"));

    await userEvent.click(screen.getByRole("button", { name: "Clear focal point" }));
    expect(screen.queryByTestId("focal-marker")).not.toBeInTheDocument();
  });

  it("changes how a picture that isn't cover-shaped fits both cover sizes", async () => {
    respond = (url, init) => (url === `/api/media/${ID}` && init?.method === "PATCH" ? json({ asset: detail }) : undefined);
    await open();
    await userEvent.selectOptions(screen.getByLabelText(/isn.t cover-shaped/), "white");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeTruthy());
    expect(JSON.parse(patchCall()!.init!.body as string).fits).toEqual({ book_cover_shelf: "white", book_cover_kdp_ebook: "white" });
    expect(track).toHaveBeenCalledWith("media_edited", expect.objectContaining({ fit: true }));
  });

  it("shows why a save failed", async () => {
    respond = (url, init) => (url === `/api/media/${ID}` && init?.method === "PATCH" ? json({ error: "title can't be empty" }, 400) : undefined);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("title can't be empty");
  });

  it("asks before deleting, and deletes", async () => {
    respond = (url, init) => (url === `/api/media/${ID}` && init?.method === "DELETE" ? json({ success: true }) : undefined);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()); // closed
    expect(track).toHaveBeenCalledWith("media_deleted", { ok: true, in_use: false });
  });

  it("refuses to delete an image that's in use, and lists where", async () => {
    const where = [{ kind: "event", id: "evt_AAAAAAAAAAA1", title: "Spring Retreat" }];
    respond = (url, init) =>
      url === `/api/media/${ID}` && init?.method === "DELETE" ? json({ error: "This image is still in use. Pick another for those first.", usages: where }, 409) : undefined;
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still in use");
    expect(screen.getByRole("link", { name: "Spring Retreat" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument(); // still open
    expect(track).toHaveBeenCalledWith("media_deleted", { ok: false, in_use: true });
  });

  it("shows why an image couldn't be loaded", async () => {
    respond = (url, init) => (url === `/api/media/${ID}` && !init?.method ? json({ error: "Not found" }, 404) : undefined);
    render(<MediaLibraryClient />);
    await userEvent.click(await screen.findByText("Hedgies on First"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
  });
});
