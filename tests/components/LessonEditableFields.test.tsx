// @vitest-environment jsdom
/** The two fields of a Hub-owned lesson's page that can be changed: its title and its setting. The actions are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ renameCourseItem: vi.fn(), setCourseItemStatus: vi.fn(), moveCourseLesson: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => actions);

import { LessonModuleField, LessonStatusField, LessonTitleField } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonEditableFields";

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
  it("offers Draft, Published and Locked, with the current one chosen, and not Schedule or Drip", () => {
    render(<LessonStatusField courseId={COURSE} lessonId={LESSON} option="published" />);
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["Draft", "Published", "Locked"]);
    expect(screen.getByRole("radio", { name: "Published" })).toBeChecked();
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

describe("LessonModuleField", () => {
  const modules = [
    { kajabiId: "mod_AAAAAAAAAAA1", path: "Module 1" },
    { kajabiId: "mod_AAAAAAAAAAA2", path: "Module 1 / Week 1" },
    { kajabiId: "mod_AAAAAAAAAAA3", path: "Bonus" },
  ];

  it("shows the lesson's own module, with a way to clear it", () => {
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="mod_AAAAAAAAAAA2" modules={modules} />);
    expect(screen.getByText("Module 1 / Week 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
  });

  it("lists only the course's modules when focused and narrows them as the person types in Find", async () => {
    const user = userEvent.setup();
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="" modules={modules} />);
    const box = screen.getByRole("combobox", { name: "Select module" });
    expect(box).toHaveAttribute("placeholder", "Find…");
    await user.click(box);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Module 1", "Module 1 / Week 1", "Bonus"]);
    await user.type(box, "week");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Module 1 / Week 1"]);
    await user.clear(box);
    await user.type(box, "zzz");
    expect(screen.getByText("No module found")).toBeInTheDocument();
  });

  it("moves the lesson to the module chosen with the mouse, and refreshes the page", async () => {
    actions.moveCourseLesson.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="" modules={modules} />);
    await user.click(screen.getByRole("combobox", { name: "Select module" }));
    await user.click(screen.getByRole("option", { name: "Module 1" }));

    expect(actions.moveCourseLesson).toHaveBeenCalledWith(COURSE, LESSON, "mod_AAAAAAAAAAA1");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("chooses with the keyboard: Arrow Down then Enter", async () => {
    actions.moveCourseLesson.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="" modules={modules} />);
    await user.click(screen.getByRole("combobox", { name: "Select module" }));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(actions.moveCourseLesson).toHaveBeenCalledWith(COURSE, LESSON, "mod_AAAAAAAAAAA2");
  });

  it("takes the lesson out of its module when the choice is cleared", async () => {
    actions.moveCourseLesson.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="mod_AAAAAAAAAAA1" modules={modules} />);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(actions.moveCourseLesson).toHaveBeenCalledWith(COURSE, LESSON, null);
  });

  it("shows why a move was refused, without refreshing", async () => {
    actions.moveCourseLesson.mockResolvedValue({ error: "That module isn't in this course. Refresh the page." });
    const user = userEvent.setup();
    render(<LessonModuleField courseId={COURSE} lessonId={LESSON} moduleId="" modules={modules} />);
    await user.click(screen.getByRole("combobox", { name: "Select module" }));
    await user.click(screen.getByRole("option", { name: "Bonus" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That module isn't in this course");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
