// @vitest-environment jsdom
/** The outline of a Hub-owned course: add, rename, duplicate, delete and reorder. The actions are faked; what is tested is what the outline sends and shows. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({
  addCourseLesson: vi.fn(),
  addCourseModule: vi.fn(),
  deleteCourseItem: vi.fn(),
  duplicateCourseItem: vi.fn(),
  renameCourseItem: vi.fn(),
  reorderCourseItems: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => actions);

import BuilderOutline, { type OutlineCourse } from "@/app/(admin)/admin/courses/BuilderOutline";
import { buildHubOutline } from "@/lib/courses/hub-outline";

const COURSE = "crs_AAAAAAAAAAA1";
const M1 = "mod_AAAAAAAAAAA1";
const M2 = "mod_AAAAAAAAAAA2";
const W1 = "mod_AAAAAAAAAAA3";
const W2 = "mod_AAAAAAAAAAA4";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";
const L3 = "les_AAAAAAAAAAA3";

const outline = buildHubOutline(
  [
    { id: M1, parent_id: null, title: "Module 1", position: 1, publishing_option: "inherit" },
    { id: M2, parent_id: null, title: "Module 2", position: 2, publishing_option: "inherit" },
    { id: W1, parent_id: M1, title: "Week 1", position: 1, publishing_option: "inherit" },
    { id: W2, parent_id: M1, title: "Week 2", position: 2, publishing_option: "inherit" },
  ],
  [
    { id: L1, module_id: W1, title: "Lesson one", position: 1, publishing_option: "inherit", hasText: true, hasVideo: false },
    { id: L2, module_id: W1, title: "Lesson two", position: 2, publishing_option: "inherit", hasText: false, hasVideo: false },
    { id: L3, module_id: M2, title: "Lesson three", position: 1, publishing_option: "inherit", hasText: false, hasVideo: false },
  ],
  "draft"
);
const course = (over: Partial<OutlineCourse> = {}): OutlineCourse => ({
  id: COURSE,
  slug: "plot-lab",
  editable: true,
  ...outline,
  hubLessonIds: Object.fromEntries(Object.keys(outline.content).map((id) => [id, id])),
  ...over,
});

beforeEach(() => {
  router.refresh.mockReset();
  for (const action of Object.values(actions)) {
    action.mockReset();
    action.mockResolvedValue({ id: "ok" });
  }
});

/** The confirmation dialog, so its buttons aren't confused with the rows' own (same names). */
const dialog = () => within(screen.getByRole("heading", { name: /^Delete (lesson|module|submodule)\?$/ }).closest("div.fixed") as HTMLElement);

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Expand all" }));
};

describe("an editable outline", () => {
  it("enables the controls an imported course has off, and keeps the status menus off for now", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    expect(screen.getByRole("button", { name: "Add module" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Duplicate module" })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Delete lesson" })[0]).toBeEnabled();
    for (const select of screen.getAllByRole("combobox")) expect(select).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Open lesson comments" })[0]).toBeDisabled();
    // The title isn't a link to a lesson page there isn't yet.
    expect(screen.queryByRole("link", { name: "Lesson one" })).not.toBeInTheDocument();
  });

  it("links a lesson and a module to the member's preview of them", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    expect(screen.getAllByRole("link", { name: "Open lesson preview" })[0]).toHaveAttribute("href", `/courses/plot-lab/lessons/${L1}`);
    expect(screen.getAllByRole("link", { name: "Open module preview" })[0]).toHaveAttribute("href", `/courses/plot-lab/modules/${M1}`);
  });

  it("has no preview links before the course has an address to preview at", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course({ slug: null })} />);
    await open(user);
    expect(screen.queryByRole("link", { name: "Open lesson preview" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open lesson preview" })[0]).toBeDisabled();
  });
});

describe("adding", () => {
  it("adds a module at the end with Enter, then refreshes the page and closes the field", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Add module" }));
    await user.type(screen.getByRole("textbox", { name: "New module name" }), "Module 3{Enter}");

    expect(actions.addCourseModule).toHaveBeenCalledWith(COURSE, null, "Module 3");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "New module name" })).not.toBeInTheDocument();
  });

  it("adds a lesson or a submodule from a module's Add content menu, but no submodule inside a submodule", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getAllByRole("button", { name: "Add content" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Add submodule" }));
    await user.type(screen.getByRole("textbox", { name: "New submodule name" }), "Week 3{Enter}");
    expect(actions.addCourseModule).toHaveBeenCalledWith(COURSE, M1, "Week 3");

    await user.click(screen.getAllByRole("button", { name: "Add content" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Add lesson" }));
    await user.type(screen.getByRole("textbox", { name: "New lesson name" }), "Lesson four{Enter}");
    expect(actions.addCourseLesson).toHaveBeenCalledWith(COURSE, M1, "Lesson four");

    // Open Module 1's first week, whose Add content menu has no submodule.
    await user.click(screen.getByRole("button", { name: "Expand Week 1" }));
    const weekRow = screen.getByText("Week 1").closest("li")!;
    await user.click(within(weekRow).getAllByRole("button", { name: "Add content" })[0]);
    expect(screen.getByRole("menuitem", { name: "Add lesson" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add submodule" })).not.toBeInTheDocument();
  });

  it("opens the module being added to, so the new field is seen", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getAllByRole("button", { name: "Add content" })[1]);
    await user.click(screen.getByRole("menuitem", { name: "Add lesson" }));
    expect(screen.getByRole("textbox", { name: "New lesson name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Module 2" })).toHaveAttribute("aria-expanded", "true");
  });

  it("cancels with Escape or Cancel, without sending anything", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Add module" }));
    await user.type(screen.getByRole("textbox", { name: "New module name" }), "Nope{Escape}");
    expect(screen.queryByRole("textbox", { name: "New module name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add module" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "New module name" })).not.toBeInTheDocument();
    expect(actions.addCourseModule).not.toHaveBeenCalled();
  });

  it("keeps the field open and shows why when the add is refused", async () => {
    actions.addCourseModule.mockResolvedValue({ error: "Give it a name." });
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Add module" }));
    await user.type(screen.getByRole("textbox", { name: "New module name" }), "x{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a name.");
    expect(screen.getByRole("textbox", { name: "New module name" })).toHaveValue("x");
    expect(router.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("renaming", () => {
  it("renames a lesson in place, starting from its name, and saves with Enter", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    const row = screen.getByText("Lesson one").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Rename lesson" }));
    const field = screen.getByRole("textbox", { name: "Lesson name" });
    expect(field).toHaveValue("Lesson one");
    await user.clear(field);
    await user.type(field, "First lesson{Enter}");

    expect(actions.renameCourseItem).toHaveBeenCalledWith(COURSE, "lesson", L1, "First lesson");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("renames a module or a submodule, with the right kind of name field", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Module 2").closest("li")!).getAllByRole("button", { name: "Edit module" })[0]);
    await user.type(screen.getByRole("textbox", { name: "Module name" }), "!{Enter}");
    expect(actions.renameCourseItem).toHaveBeenCalledWith(COURSE, "module", M2, "Module 2!");

    await user.click(within(screen.getByText("Week 2").closest("li")!).getAllByRole("button", { name: "Edit submodule" })[0]);
    await user.type(screen.getByRole("textbox", { name: "Submodule name" }), "?{Enter}");
    expect(actions.renameCourseItem).toHaveBeenCalledWith(COURSE, "module", W2, "Week 2?");
  });

  it("leaves the name as it was on Escape", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Rename lesson" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson name" }), "zzz{Escape}");
    expect(screen.getByText("Lesson one")).toBeInTheDocument();
    expect(actions.renameCourseItem).not.toHaveBeenCalled();
  });
});

describe("duplicating", () => {
  it("duplicates a lesson, a module and a submodule, and refreshes", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson three").closest("li")!).getByRole("button", { name: "Duplicate lesson" }));
    expect(actions.duplicateCourseItem).toHaveBeenCalledWith(COURSE, "lesson", L3);
    await user.click(within(screen.getByText("Module 2").closest("li")!).getAllByRole("button", { name: "Duplicate module" })[0]);
    expect(actions.duplicateCourseItem).toHaveBeenCalledWith(COURSE, "module", M2);
    await user.click(within(screen.getByText("Week 2").closest("li")!).getAllByRole("button", { name: "Duplicate submodule" })[0]);
    expect(actions.duplicateCourseItem).toHaveBeenCalledWith(COURSE, "module", W2);
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });
});

describe("deleting", () => {
  it("asks first, and deletes nothing if cancelled", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Delete lesson" }));
    expect(screen.getByRole("heading", { name: "Delete lesson?" })).toBeInTheDocument();
    expect(screen.getByText(/“Lesson one” will be deleted for good\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Delete lesson?" })).not.toBeInTheDocument();
    expect(actions.deleteCourseItem).not.toHaveBeenCalled();
  });

  it("deletes a lesson once confirmed, and closes the question", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Delete lesson" }));
    await user.click(dialog().getByRole("button", { name: "Delete lesson" }));
    expect(actions.deleteCourseItem).toHaveBeenCalledWith(COURSE, "lesson", L1);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Delete lesson?" })).not.toBeInTheDocument();
  });

  it("says what goes with a module: its lessons and submodules", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(within(screen.getByText("Module 1").closest("li")!).getAllByRole("button", { name: "Delete module" })[0]);
    expect(screen.getByText(/Its 2 lessons and 2 submodules will be deleted with it\./)).toBeInTheDocument();
    await user.click(dialog().getByRole("button", { name: "Delete module" }));
    expect(actions.deleteCourseItem).toHaveBeenCalledWith(COURSE, "module", M1);
  });

  it("says nothing about contents for an empty module, and calls a submodule one", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Week 2").closest("li")!).getAllByRole("button", { name: "Delete submodule" })[0]);
    expect(screen.getByRole("heading", { name: "Delete submodule?" })).toBeInTheDocument();
    expect(screen.getByText("“Week 2” will be deleted for good.")).toBeInTheDocument();
  });

  it("shows why a delete was refused (members have progress), after closing the question", async () => {
    actions.deleteCourseItem.mockResolvedValue({ error: "Members have progress in this lesson, so it can't be deleted. Hide it instead." });
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Delete lesson" }));
    await user.click(dialog().getByRole("button", { name: "Delete lesson" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Members have progress in this lesson");
    expect(screen.queryByRole("heading", { name: "Delete lesson?" })).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("reordering", () => {
  it("moves an item up or down with its buttons, sending the whole new order of its list", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Move lesson down" }));
    expect(actions.reorderCourseItems).toHaveBeenLastCalledWith(COURSE, "lesson", W1, [L2, L1]);
    await user.click(within(screen.getByText("Lesson two").closest("li")!).getByRole("button", { name: "Move lesson up" }));
    expect(actions.reorderCourseItems).toHaveBeenLastCalledWith(COURSE, "lesson", W1, [L2, L1]);
    await user.click(within(screen.getByText("Module 2").closest("li")!).getAllByRole("button", { name: "Move module up" })[0]);
    expect(actions.reorderCourseItems).toHaveBeenLastCalledWith(COURSE, "module", null, [M2, M1]);
    await user.click(within(screen.getByText("Week 1").closest("li")!).getAllByRole("button", { name: "Move submodule down" })[0]);
    expect(actions.reorderCourseItems).toHaveBeenLastCalledWith(COURSE, "module", M1, [W2, W1]);
  });

  it("has no Move up for the first or Move down for the last", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    expect(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Move lesson up" })).toBeDisabled();
    expect(within(screen.getByText("Lesson two").closest("li")!).getByRole("button", { name: "Move lesson down" })).toBeDisabled();
    expect(within(screen.getByText("Lesson three").closest("li")!).getByRole("button", { name: "Move lesson up" })).toBeDisabled();
    expect(within(screen.getByText("Lesson three").closest("li")!).getByRole("button", { name: "Move lesson down" })).toBeDisabled();
  });

  it("puts a dragged item where the one it is dropped on is, within its own list", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    const handle = within(screen.getByText("Module 2").closest("li")!).getAllByRole("img", { name: "Drag to reorder module" })[0];
    const target = screen.getByText("Module 1").closest("li")!;
    const transfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(actions.reorderCourseItems).toHaveBeenCalledWith(COURSE, "module", null, [M2, M1]);
    expect(transfer.setData).toHaveBeenCalledWith("text/plain", M2);
    void user;
  });

  it("ignores a drop on another kind of row or another list, and a drop on itself", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    const transfer = { setData: vi.fn(), effectAllowed: "" };
    // A lesson dragged onto a module, onto a lesson of another module, and onto itself.
    const handle = within(screen.getByText("Lesson one").closest("li")!).getByRole("img", { name: "Drag to reorder lesson" });
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    fireEvent.drop(screen.getByText("Module 2").closest("li")!, { dataTransfer: transfer });
    fireEvent.drop(screen.getByText("Lesson three").closest("li")!, { dataTransfer: transfer });
    fireEvent.drop(screen.getByText("Lesson one").closest("li")!, { dataTransfer: transfer });
    expect(actions.reorderCourseItems).not.toHaveBeenCalled();
    void user;
  });

  it("ignores a drop when nothing is being dragged", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    fireEvent.drop(screen.getByText("Lesson one").closest("li")!, { dataTransfer: { setData: vi.fn() } });
    expect(actions.reorderCourseItems).not.toHaveBeenCalled();
  });

  it("shows why a reorder was refused as out of date, and doesn't refresh", async () => {
    actions.reorderCourseItems.mockResolvedValue({ error: "The outline changed since you opened it. Refresh the page and try again." });
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson one").closest("li")!).getByRole("button", { name: "Move lesson down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The outline changed since you opened it");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offers no reordering while searching, since the list on screen is not the whole list", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.type(screen.getByRole("searchbox", { name: "Find module or lesson" }), "Lesson");
    expect(screen.queryByRole("button", { name: "Move lesson down" })).not.toBeInTheDocument();
    // The handles stay as plain icons, but none can be dragged.
    for (const handle of screen.queryAllByRole("img", { name: "Drag to reorder lesson" })) expect(handle).not.toHaveAttribute("draggable");
    expect(screen.queryByRole("button", { name: "Move lesson up" })).not.toBeInTheDocument();
  });
});

describe("when something goes wrong", () => {
  it("tells the person, and keeps the outline usable, if an action throws", async () => {
    actions.duplicateCourseItem.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson three").closest("li")!).getByRole("button", { name: "Duplicate lesson" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Refresh the page and try again.");
    expect(screen.getByRole("button", { name: "Add module" })).toBeEnabled();
  });

  it("turns the controls off while a change is on its way", async () => {
    let finish: (value: { id: string }) => void = () => {};
    actions.duplicateCourseItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await open(user);
    await user.click(within(screen.getByText("Lesson three").closest("li")!).getByRole("button", { name: "Duplicate lesson" }));
    expect(screen.getByRole("button", { name: "Add module" })).toBeDisabled();
    finish({ id: "x" });
    expect(await screen.findByRole("button", { name: "Add module" })).toBeEnabled();
  });
});

describe("an imported course", () => {
  it("stays read only: no controls work, and nothing is sent", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course({ editable: false })} />);
    await open(user);
    expect(screen.getByRole("button", { name: "Add module" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Add content" })[0]).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Move lesson down" })).not.toBeInTheDocument();
    for (const handle of screen.getAllByRole("img", { name: "Drag to reorder lesson" })) {
      expect(handle).toHaveAttribute("title", expect.stringMatching(/imported from Kajabi/));
      expect(handle).not.toHaveAttribute("draggable");
    }
    await user.click(screen.getAllByRole("button", { name: "Duplicate module" })[0]);
    expect(actions.duplicateCourseItem).not.toHaveBeenCalled();
  });
});
