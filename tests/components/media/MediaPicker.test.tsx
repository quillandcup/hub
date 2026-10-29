// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
const uploadToSignedUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }) }));

import MediaPicker from "@/components/media/MediaPicker";

const A = { id: "media_AAAAAAAAAAA1", title: "Hedgies on First", alt_text: "A hedgehog at a desk" };
const B = { id: "media_BBBBBBBBBBB2", title: "Retreat lodge", alt_text: null };

let library: { id: string; title: string; alt_text: string | null }[];
let calls: { url: string; init?: RequestInit }[];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  library = [A, B];
  calls = [];
  respond = () => undefined;
  track.mockReset();
  uploadToSignedUrl.mockReset();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const custom = await respond(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/media?")) {
      const q = new URL(url, "http://x").searchParams.get("q") ?? "";
      return json({ assets: library.filter((a) => a.title.toLowerCase().includes(q.toLowerCase())) });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(value: string | null = null) {
  const onChange = vi.fn();
  render(<MediaPicker value={value} onChange={onChange} surface="event_cover" />);
  return onChange;
}
const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Choose image|Change image/ }));
  await screen.findByRole("tablist");
};

describe("MediaPicker", () => {
  it("shows the current image at the preset's crop, with Change and Remove; empty it offers Choose", async () => {
    const onChange = setup(A.id);
    expect(screen.getByAltText("The chosen image")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/event_card");
    expect(screen.getByRole("button", { name: "Change image" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(track).toHaveBeenCalledWith("media_cleared", { surface: "event_cover" });
    cleanup();
    setup();
    expect(screen.getByText("No image chosen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("opens the library, lists the images and picks one", async () => {
    const onChange = setup();
    await open();
    expect(track).toHaveBeenCalledWith("media_picker_opened", { surface: "event_cover" });
    expect(await screen.findByText("Hedgies on First")).toBeInTheDocument();
    expect(screen.getByAltText("A hedgehog at a desk")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/thumb");

    await userEvent.click(screen.getByText("Retreat lodge"));
    expect(onChange).toHaveBeenCalledWith("media_BBBBBBBBBBB2");
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "library", searched: false });
    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument()); // closed
  });

  it("searches as you type and says when nothing matches", async () => {
    const onChange = setup();
    await open();
    await screen.findByText("Hedgies on First");
    await userEvent.type(screen.getByRole("searchbox"), "lodge");
    await waitFor(() => expect(screen.queryByText("Hedgies on First")).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("q=lodge"))).toBe(true);
    await userEvent.click(screen.getByText("Retreat lodge"));
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "library", searched: true });
    expect(onChange).toHaveBeenCalledWith(B.id);
  });

  it("offers an upload when the library is empty, and shows a load error", async () => {
    library = [];
    setup();
    await open();
    expect(await screen.findByText(/No images yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload one" }));
    expect(screen.getByLabelText("Image file")).toBeInTheDocument();
    cleanup();

    respond = (url) => (url.startsWith("/api/media?") ? json({ error: "Forbidden" }, 403) : undefined);
    setup();
    await open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("uploads a small file as form data and uses it, telling analytics when HEIC was converted", async () => {
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ asset: { id: "media_CCCCCCCCCCC3" }, duplicate: false, convertedFrom: "heic" }, 201) : undefined);
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    expect(screen.getByRole("button", { name: "Upload and use" })).toBeDisabled();

    const file = new File([new Uint8Array(1000)], "IMG_0001.heic", { type: "image/heic" });
    await userEvent.upload(screen.getByLabelText("Image file"), file);
    await userEvent.type(screen.getByLabelText("Title"), "Phone photo");
    await userEvent.type(screen.getByLabelText("Tags"), "retreat, lodge");
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("media_CCCCCCCCCCC3"));
    const post = calls.find((c) => c.url === "/api/media" && c.init?.method === "POST")!;
    const form = post.init!.body as FormData;
    expect([form.get("title"), form.get("tags")]).toEqual(["Phone photo", "retreat,lodge"]);
    expect((form.get("file") as File).name).toBe("IMG_0001.heic");
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: true, converted: true, duplicate: false, large: false });
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "upload", searched: false });
  });

  it("sends a big file straight to storage through a signed URL, then confirms it", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: null });
    respond = (url, init) => {
      if (url === "/api/media/uploads") return json({ uploadPath: "uploads/abc", token: "tok", signedUrl: "https://x" });
      if (url === "/api/media" && init?.method === "POST") return json({ asset: { id: "media_DDDDDDDDDDD4" }, duplicate: true }, 200);
      return undefined;
    };
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    const big = new File([new Uint8Array(5 * 1024 * 1024)], "cover.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Image file"), big);
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("media_DDDDDDDDDDD4"));
    expect(uploadToSignedUrl).toHaveBeenCalledWith("uploads/abc", "tok", big, { contentType: "image/png" });
    const confirm = calls.find((c) => c.url === "/api/media" && c.init?.method === "POST")!;
    expect(JSON.parse(confirm.init!.body as string)).toMatchObject({ uploadPath: "uploads/abc", tags: [] });
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: true, converted: false, duplicate: true, large: true });
  });

  it("shows why an upload failed and keeps the picker open", async () => {
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ error: "Use a JPEG, PNG, WebP, GIF or AVIF image" }, 400) : undefined);
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG");
    expect(onChange).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: false, converted: false, duplicate: false, large: false });
    expect(screen.getByRole("button", { name: "Upload and use" })).toBeEnabled();
  });
});
