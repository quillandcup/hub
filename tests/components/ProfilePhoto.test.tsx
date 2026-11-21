// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfilePhoto, { SOURCE_TEXT, whoSeesPhoto } from "@/app/(member)/settings/ProfilePhoto";
import { MEMBER_PHOTO } from "@/lib/config";
import type { PhotoSource } from "@/lib/members/photo";
import type { Visibility } from "@/lib/writing-visibility";

const onChanged = vi.fn(async () => {});
const fetchMock = vi.fn();

type Photo = { name: string; url: string | null; source: PhotoSource; canChange: boolean };
const own: Photo = { name: "Ada Example", url: "https://storage.example.test/member-photos/a.webp", source: "uploaded", canChange: true };
const show = (photo: Partial<Photo> = {}, level: Visibility = "community", webOpen = true) =>
  render(<ProfilePhoto photo={{ ...own, ...photo }} level={level} webOpen={webOpen} onChanged={onChanged} />);
const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });
const file = (name = "me.png", type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });
const choose = (f: File) => userEvent.upload(screen.getByLabelText("Choose a photo to upload"), f, { applyAccept: false });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the picture and where it comes from", () => {
  it.each(Object.entries(SOURCE_TEXT) as [PhotoSource, string][])("says in words that the photo is: %s", (source, text) => {
    show({ source, url: source === "none" ? null : own.url });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("shows the photo itself, or the initials when there is none", () => {
    const { unmount } = show();
    expect(screen.getByRole("img", { name: "Ada Example" })).toHaveAttribute("src", own.url!);
    unmount();

    show({ source: "none", url: null });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("names no vendor for a photo from when they joined", () => {
    expect(SOURCE_TEXT.kajabi).not.toMatch(/Kajabi/);
  });
});

describe("what the lock, the house and the globe mean for the photo", () => {
  it("says that with the lock other members see initials instead", () => {
    show({}, "private");
    expect(screen.getByText("Only you see your photo; other members see your initials instead.")).toBeInTheDocument();
  });

  it("says that with the house other members see the photo, and with no photo only initials", () => {
    expect(whoSeesPhoto("community", "uploaded", true)).toBe("Other members see your photo.");
    expect(whoSeesPhoto("community", "none", true)).toBe("Other members see your initials until you add a photo.");
  });

  it("says the globe is the web only where writer profiles are open", () => {
    expect(whoSeesPhoto("public", "uploaded", true)).toBe("Other members see your photo and anyone on the web sees it on your writer profile once it is on.");
    expect(whoSeesPhoto("public", "uploaded", false)).toBe("Other members see your photo.");
  });

  it("explains the Gravatar copy only for a Gravatar photo, where the globe is offered", () => {
    const { unmount } = show({ source: "gravatar" }, "community", true);
    expect(screen.getByText(/saves a copy of your Gravatar picture here once/)).toBeInTheDocument();
    unmount();

    show({ source: "gravatar" }, "community", false);
    expect(screen.queryByText(/saves a copy of your Gravatar picture/)).not.toBeInTheDocument();
  });
});

describe("uploading", () => {
  it("sends the file to the server, then asks the panel to reload", async () => {
    answer({ url: "x" });
    show({ source: "none", url: null });
    expect(screen.getByRole("button", { name: "Upload a photo" })).toBeInTheDocument();

    await choose(file("holiday.png"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/profile/photo");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("photo")).toBeInstanceOf(File);
    expect(await screen.findByText("Photo saved.")).toBeInTheDocument();
  });

  it("offers Replace once there is a photo of their own", () => {
    show();
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeInTheDocument();
  });

  it("refuses a file over the limit without sending it", async () => {
    show();
    await choose(file("big.png", "image/png", MEMBER_PHOTO.maxUploadBytes + 1));

    expect(await screen.findByRole("status")).toHaveTextContent(/Use a photo of \d+ MB or less/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason, and does not reload", async () => {
    answer({ error: "Use a JPEG, PNG or WebP photo." }, false);
    show();

    await choose(file("a.gif", "image/gif"));

    expect(await screen.findByText("Use a JPEG, PNG or WebP photo.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says so when the request itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    show();

    await choose(file());

    expect(await screen.findByText(/Couldn't save your photo/)).toBeInTheDocument();
  });

  it("tells them what is done to the file", () => {
    show();
    expect(screen.getByText(/remove hidden details such as where it was taken/)).toBeInTheDocument();
  });
});

describe("removing", () => {
  it("asks first, says it cannot be undone, and does nothing when they cancel", async () => {
    show();

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Remove your photo?");
    expect(dialog).toHaveTextContent("can't be brought back");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes it once confirmed and reloads", async () => {
    answer({ removed: true });
    show();

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(await screen.findByText("Photo removed.")).toBeInTheDocument();
  });

  it("keeps the dialog open with the reason when it fails", async () => {
    answer({ error: "Couldn't remove your photo. Please try again." }, false);
    show();

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove photo" }));

    expect(await within(await screen.findByRole("dialog")).findByText(/Couldn't remove your photo/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("is not offered for a photo that is not their own", () => {
    show({ source: "slack" });
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });
});

describe("while staff look as the member (sudo)", () => {
  it("shows the photo and who sees it, with nothing to change it", () => {
    show({ canChange: false });
    expect(screen.getByRole("img", { name: "Ada Example" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /photo/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose a photo to upload")).not.toBeInTheDocument();
  });
});
