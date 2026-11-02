// @vitest-environment jsdom
/** Deleting a Hub-owned lesson from its page: it asks first, shows a refusal inside the question, and goes back to the course once the lesson is gone. The action is faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ deleteCourseItem: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => actions);

import LessonDeleteButton from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonDeleteButton";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Delete lesson" }));
  return within(screen.getByRole("dialog"));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LessonDeleteButton", () => {
  it("asks first, naming the lesson and what goes with it, and deletes nothing yet", async () => {
    const user = userEvent.setup();
    render(<LessonDeleteButton courseId={COURSE} lessonId={LESSON} title="Welcome" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = await open(user);
    expect(dialog.getByText(/“Welcome” will be deleted for good, with its text, its video link and its downloads/)).toBeInTheDocument();
    expect(actions.deleteCourseItem).not.toHaveBeenCalled();
  });

  it("deletes the lesson once confirmed and goes back to the course", async () => {
    actions.deleteCourseItem.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonDeleteButton courseId={COURSE} lessonId={LESSON} title="Welcome" />);
    await user.click((await open(user)).getByRole("button", { name: "Delete lesson" }));

    expect(actions.deleteCourseItem).toHaveBeenCalledWith(COURSE, "lesson", LESSON);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/courses/${COURSE}`));
  });

  it("can be cancelled without doing anything", async () => {
    const user = userEvent.setup();
    render(<LessonDeleteButton courseId={COURSE} lessonId={LESSON} title="Welcome" />);
    await user.click((await open(user)).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.deleteCourseItem).not.toHaveBeenCalled();
  });

  it("shows why it was refused inside the question and stays on the page", async () => {
    actions.deleteCourseItem.mockResolvedValue({ error: "Members have progress in this lesson, so it can't be deleted. Hide it instead." });
    const user = userEvent.setup();
    render(<LessonDeleteButton courseId={COURSE} lessonId={LESSON} title="Welcome" />);
    await user.click((await open(user)).getByRole("button", { name: "Delete lesson" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Members have progress in this lesson");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("tells the person when the action throws", async () => {
    actions.deleteCourseItem.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<LessonDeleteButton courseId={COURSE} lessonId={LESSON} title="Welcome" />);
    await user.click((await open(user)).getByRole("button", { name: "Delete lesson" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
