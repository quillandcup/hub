// @vitest-environment jsdom
/** The two fields of a Hub-owned lesson's page that can be changed: its title and its setting. The actions are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ renameCourseItem: vi.fn(), setCourseItemStatus: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => actions);

import { LessonStatusField, LessonTitleField } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonEditableFields";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LessonTitleField", () => {
  it("saves a changed title when the field is left, trimmed, and refreshes the page", async () => {
    actions.renameCourseItem.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonTitleField courseId={COURSE} lessonId={LESSON} title="Old" />);
    const field = screen.getByRole("textbox", { name: "Title" });
    await user.clear(field);
    await user.type(field, "  New name  {Enter}");
    expect(actions.renameCourseItem).toHaveBeenCalledWith(COURSE, "lesson", LESSON, "New name");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("sends nothing when the title is unchanged", async () => {
    const user = userEvent.setup();
    render(<LessonTitleField courseId={COURSE} lessonId={LESSON} title="Same" />);
    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.tab();
    expect(actions.renameCourseItem).not.toHaveBeenCalled();
  });

  it("shows why a rename was refused and puts the old title back", async () => {
    actions.renameCourseItem.mockResolvedValue({ error: "Give it a name." });
    const user = userEvent.setup();
    render(<LessonTitleField courseId={COURSE} lessonId={LESSON} title="Keep" />);
    const field = screen.getByRole("textbox", { name: "Title" });
    await user.clear(field);
    await user.type(field, "x{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a name.");
    expect(field).toHaveValue("Keep");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("tells the person when the action throws", async () => {
    actions.renameCourseItem.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<LessonTitleField courseId={COURSE} lessonId={LESSON} title="Keep" />);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("LessonStatusField", () => {
  it("offers following what is above, Draft, Published and Locked, with the current one chosen, and not Schedule or Drip", () => {
    render(<LessonStatusField courseId={COURSE} lessonId={LESSON} option="inherit" />);
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["Follows what is above", "Draft", "Published", "Locked"]);
    expect(screen.getByRole("radio", { name: "Follows what is above" })).toBeChecked();
  });

  it("sends the chosen setting for this lesson and refreshes", async () => {
    actions.setCourseItemStatus.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonStatusField courseId={COURSE} lessonId={LESSON} option="draft" />);
    await user.click(screen.getByRole("radio", { name: "Published" }));
    expect(actions.setCourseItemStatus).toHaveBeenCalledWith(COURSE, "lesson", LESSON, "published");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("shows why a change was refused, without refreshing", async () => {
    actions.setCourseItemStatus.mockResolvedValue({ error: "Not found." });
    const user = userEvent.setup();
    render(<LessonStatusField courseId={COURSE} lessonId={LESSON} option="draft" />);
    await user.click(screen.getByRole("radio", { name: "Locked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found.");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
