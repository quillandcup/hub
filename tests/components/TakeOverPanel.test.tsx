// @vitest-environment jsdom
/** "Edit this course in the Hub": what it says before it does anything, what it asks the action for, and what it shows when that is refused. The action is faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ takeOverCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/take-over-actions", () => actions);

import TakeOverPanel from "@/app/(admin)/admin/courses/[id]/TakeOverPanel";
import type { TakeOverPreview } from "@/lib/courses/take-over";

const COURSE = "crs_AAAAAAAAAAA1";
const preview = (over: Partial<TakeOverPreview> = {}): TakeOverPreview => ({ modules: 3, lessons: 12, withText: 10, withVideo: 8, downloads: 4, withoutSetting: 0, tooDeep: false, ...over });
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Take over from Kajabi" }));
  return within(screen.getByRole("dialog"));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TakeOverPanel", () => {
  it("offers the take-over, and does nothing until it is confirmed", async () => {
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="The Ready Writer" preview={preview()} />);
    expect(screen.getByRole("heading", { name: "Edit this course in the Hub" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = await open(user);
    expect(dialog.getByText("The Ready Writer")).toBeInTheDocument();
    expect(actions.takeOverCourse).not.toHaveBeenCalled();
  });

  it("says what moves over, that the import skips the course, and that it can't be undone", async () => {
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview()} />);
    const dialog = await open(user);

    expect(dialog.getByText(/3 modules and 12 lessons \(10 with text, 8 with a video\), 4 downloads/)).toBeInTheDocument();
    expect(dialog.getByText("The Kajabi import skips this course from now on.")).toBeInTheDocument();
    expect(dialog.getByText("It can't be undone.")).toBeInTheDocument();
    expect(dialog.queryByText(/no status in Kajabi/)).not.toBeInTheDocument();
  });

  it("says how many items have no status, in the singular and the plural", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TakeOverPanel courseId={COURSE} title="C" preview={preview({ withoutSetting: 1, modules: 1, lessons: 1, downloads: 1 })} />);
    expect((await open(user)).getByText(/1 item has no status in Kajabi. It becomes a draft/)).toBeInTheDocument();
    unmount();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview({ withoutSetting: 5 })} />);
    expect((await open(user)).getByText(/5 items have no status in Kajabi. They become drafts/)).toBeInTheDocument();
  });

  it("takes the course over when confirmed, closes, and refreshes the page", async () => {
    actions.takeOverCourse.mockResolvedValue({ id: COURSE });
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview()} />);
    const dialog = await open(user);
    await user.click(dialog.getByRole("button", { name: "Take over" }));

    expect(actions.takeOverCourse).toHaveBeenCalledWith(COURSE);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can be cancelled without doing anything", async () => {
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.takeOverCourse).not.toHaveBeenCalled();
  });

  it("shows why it was refused and stays open, without refreshing", async () => {
    actions.takeOverCourse.mockResolvedValue({ error: "Couldn't take the course over." });
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Take over" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't take the course over.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("tells the person when the action throws", async () => {
    actions.takeOverCourse.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview()} />);
    await user.click((await open(user)).getByRole("button", { name: "Take over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("is off, with the reason, for a course nested too deep and for one with no lessons", () => {
    const { unmount } = render(<TakeOverPanel courseId={COURSE} title="C" preview={preview({ tooDeep: true })} />);
    expect(screen.getByRole("button", { name: "Take over from Kajabi" })).toBeDisabled();
    expect(screen.getByText(/nested deeper than the editor handles/)).toBeInTheDocument();
    unmount();
    render(<TakeOverPanel courseId={COURSE} title="C" preview={preview({ lessons: 0, modules: 0 })} />);
    expect(screen.getByRole("button", { name: "Take over from Kajabi" })).toBeDisabled();
    expect(screen.getByText(/no lessons in the Hub yet/)).toBeInTheDocument();
  });
});
