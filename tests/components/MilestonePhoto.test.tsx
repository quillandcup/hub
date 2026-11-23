// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MilestonePhoto from "@/components/writing/MilestonePhoto";
import { MILESTONE_PHOTO } from "@/lib/config";
import { MILESTONE_PHOTO_ALT, MILESTONE_PHOTO_PROMPT } from "@/lib/finishers";

const refresh = vi.fn();
const setAlt = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(member)/settings/milestoneActions", () => ({ setMilestonePhotoAlt: (...args: unknown[]) => setAlt(...args) }));

const TOKEN = "0123456789abcdef0123456789abcdef";
const fetchMock = vi.fn();

const renderPhoto = (props: Partial<React.ComponentProps<typeof MilestonePhoto>> = {}) =>
  render(<MilestonePhoto target="milestone" id="mlst_AAAAAAAAAAA1" kind="the_end" photo={null} visibilityLine="Only you can see this photo." readOnly={false} idPrefix="t" {...props} />);

const file = (size = 10, type = "image/png") => new File([new Uint8Array(size)], "me.png", { type });
const chooseFile = async (f: File) => {
  const user = userEvent.setup();
  const input = screen.getByLabelText(/Choose a (new )?photo/) as HTMLInputElement;
  await user.upload(input, f);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  setAlt.mockResolvedValue({ success: true });
});

describe("MilestonePhoto: nothing added yet", () => {
  it("says what is welcome, who would see it, and offers one button to add it", () => {
    renderPhoto();
    expect(screen.getByText(MILESTONE_PHOTO_PROMPT.the_end)).toBeInTheDocument();
    expect(screen.getByTestId("milestone-photo-line")).toHaveTextContent("Only you can see this photo.");
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG or WebP photo, up to 4 MB/)).toBeInTheDocument();
  });

  it("sends the chosen photo with where it goes, then shows it asking the route for it by its token", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ token: TOKEN, alt: null }) });
    renderPhoto();
    await chooseFile(file());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/milestone-photos");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("target")).toBe("milestone");
    expect(body.get("id")).toBe("mlst_AAAAAAAAAAA1");
    expect(body.get("photo")).toBeInstanceOf(File);
    const image = await screen.findByRole("img");
    expect(image).toHaveAttribute("src", `/api/milestone-photos/${TOKEN}`);
    expect(image).toHaveAttribute("alt", MILESTONE_PHOTO_ALT.the_end);
    expect(image).toHaveAttribute("loading", "lazy");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
  });

  it("refuses a file over the limit without sending it", async () => {
    renderPhoto();
    await chooseFile(file(MILESTONE_PHOTO.maxUploadBytes + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a photo of 4 MB or less.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows what the server said when it refuses the photo, and a plain line when it cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "That doesn't look like a photo we can use." }) });
    renderPhoto();
    await chooseFile(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("That doesn't look like a photo we can use.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await chooseFile(file());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/check your connection/));
  });
});

describe("MilestonePhoto: a photo is there", () => {
  const withPhoto = (extra: Partial<React.ComponentProps<typeof MilestonePhoto>> = {}) => renderPhoto({ photo: { token: TOKEN, alt: "Me at my desk" }, ...extra });

  it("shows it small in a fixed-shape box, with the description the member wrote as its alt text", () => {
    withPhoto();
    const image = screen.getByRole("img", { name: "Me at my desk" });
    expect(image).toHaveAttribute("src", `/api/milestone-photos/${TOKEN}`);
    expect(image.parentElement?.className).toMatch(/aspect-\[4\/3\]/);
    expect(screen.queryByText(MILESTONE_PHOTO_PROMPT.the_end)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeEnabled();
  });

  it("falls back to words for the step when there is no description", () => {
    withPhoto({ photo: { token: TOKEN, alt: null }, kind: "published", target: "book", id: "book_AAAAAAAAAAA1" });
    expect(screen.getByRole("img")).toHaveAttribute("alt", MILESTONE_PHOTO_ALT.published);
  });

  it("saves a changed description, and only offers Save once it differs", async () => {
    const user = userEvent.setup();
    withPhoto();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    const field = screen.getByLabelText("What does the photo show? (optional)");
    await user.clear(field);
    await user.type(field, "With tea");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setAlt).toHaveBeenCalledWith("milestone", "mlst_AAAAAAAAAAA1", "With tea"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute("alt", "With tea");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows why a description could not be saved", async () => {
    setAlt.mockResolvedValue({ error: "Please keep the description under 300 characters." });
    const user = userEvent.setup();
    withPhoto();
    await user.type(screen.getByLabelText("What does the photo show? (optional)"), " more");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("under 300 characters");
  });

  it("asks before removing, says it cannot be undone, and then deletes it", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ removed: true }) });
    const user = userEvent.setup();
    withPhoto();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(await screen.findByText("Remove this photo?")).toBeInTheDocument();
    expect(screen.getByText(/can't get it back/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Remove photo" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/milestone-photos?target=milestone&id=mlst_AAAAAAAAAAA1", { method: "DELETE" }));
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
  });

  it("keeps the photo and says so when it could not be removed, and does nothing when the member cancels", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Couldn't remove your photo. Please try again." }) });
    const user = userEvent.setup();
    withPhoto();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getAllByRole("button", { name: "Remove photo" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove your photo");
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("is look-only for staff viewing as the member", () => {
    withPhoto({ readOnly: true });
    expect(screen.getByRole("button", { name: "Change photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeDisabled();
    expect(screen.getByLabelText("What does the photo show? (optional)")).toBeDisabled();
  });
});
