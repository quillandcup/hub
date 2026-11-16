// @vitest-environment jsdom
/** "Duplicate course": what it says before it does anything, what it asks the action for, where it goes after, and what it shows when that is refused. The action is faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ duplicateCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/duplicate-actions", () => actions);

import Dialog from "@/app/(admin)/admin/courses/[id]/DuplicatePanel";
import type { DuplicatePreview } from "@/lib/courses/duplicate";

/** The dialog is opened from the actions menu; here a button stands in for it. */
function DuplicatePanel(props: Omit<React.ComponentProps<typeof Dialog>, "open" | "onClose">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Duplicate course</button>
      <Dialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const COURSE = "crs_AAAAAAAAAAA1";
const preview = (over: Partial<DuplicatePreview> = {}): DuplicatePreview => ({ modules: 3, lessons: 12, withVideo: 8, downloads: 4, tooDeep: false, ...over });
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Duplicate course" }));
  return within(screen.getByRole("dialog"));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DuplicatePanel", () => {
  it("offers the copy, and does nothing until it is confirmed", async () => {
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="The Ready Writer" preview={preview()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = await open(user);
    expect(dialog.getByText(/The Ready Writer \(copy\)/)).toBeInTheDocument();
    expect(actions.duplicateCourse).not.toHaveBeenCalled();
  });

  it("says what is copied and what is not, and that the copy is a draft Kajabi never touches", async () => {
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    const dialog = await open(user);

    expect(dialog.getByText(/3 modules and 12 lessons in the same order, with their text, pictures and 4 downloads/)).toBeInTheDocument();
    expect(dialog.getByText(/8 lessons with a video play the same video/)).toBeInTheDocument();
    expect(dialog.getByText(/members' access and progress, comments, and the link to a program/)).toBeInTheDocument();
    expect(dialog.getByText(/Kajabi never touches it, and this course keeps syncing as\s+before/)).toBeInTheDocument();
  });

  it("uses the singular for one lesson with a video", async () => {
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview({ modules: 1, lessons: 1, withVideo: 1, downloads: 1 })} />);
    const dialog = await open(user);
    expect(dialog.getByText(/1 module and 1 lesson in the same order, with their text, pictures and 1 download/)).toBeInTheDocument();
    expect(dialog.getByText(/1 lesson with a video plays the same video/)).toBeInTheDocument();
  });

  it("duplicates when confirmed, closes, and opens the new course", async () => {
    actions.duplicateCourse.mockResolvedValue({ id: "crs_BBBBBBBBBBB2" });
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Duplicate" }));

    expect(actions.duplicateCourse).toHaveBeenCalledWith(COURSE);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/courses/crs_BBBBBBBBBBB2"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can be cancelled without doing anything", async () => {
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.duplicateCourse).not.toHaveBeenCalled();
  });

  it("shows why it was refused and stays open, without navigating", async () => {
    actions.duplicateCourse.mockResolvedValue({ error: "Couldn't copy the course." });
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Duplicate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the course.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a general message when the answer has no id and no error", async () => {
    actions.duplicateCourse.mockResolvedValue({});
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the course.");
  });

  it("tells the person when the action throws", async () => {
    actions.duplicateCourse.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<DuplicatePanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

});
