// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The outline's actions reach the database; its own tests (BuilderOutline.editing.test.tsx) fake them.
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => ({
  addCourseLesson: vi.fn(),
  addCourseModule: vi.fn(),
  deleteCourseItem: vi.fn(),
  duplicateCourseItem: vi.fn(),
  renameCourseItem: vi.fn(),
  reorderCourseItems: vi.fn(),
}));

import BuilderOutline, { type OutlineCourse } from "@/app/(admin)/admin/courses/BuilderOutline";
import { explainCourse } from "@/lib/courses/explain";

const explained = explainCourse(
  [
    { kajabiId: "m1", parentKajabiId: null, position: 1, title: "Module 1", publishingOption: "draft" },
    { kajabiId: "w1", parentKajabiId: "m1", position: 1, title: "Week 1", publishingOption: "draft" },
    { kajabiId: "m2", parentKajabiId: null, position: 2, title: "Module 2", publishingOption: "locked" },
  ],
  [
    { kajabiId: "l1", moduleKajabiId: "w1", position: 1, title: "Sharpen your quill", publishingOption: "draft" },
    { kajabiId: "l2", moduleKajabiId: "m2", position: 1, title: "Reader expectations", publishingOption: "published" },
    { kajabiId: "l3", moduleKajabiId: null, position: 1, title: "Welcome", publishingOption: "published" },
  ]
);

const course = (over: Partial<OutlineCourse> = {}): OutlineCourse => ({
  id: "crs_AAAAAAAAAAA1",
  slug: "the-ready-writer",
  loose: explained.loose,
  modules: explained.modules,
  content: { l2: { hasText: true, hasVideo: false } },
  hubLessonIds: { l2: "les_AAAAAAAAAAA2" },
  ...over,
});

describe("BuilderOutline", () => {
  it("starts with the modules collapsed, counting them, and opens one at a time", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    expect(screen.getByText("2 Modules")).toBeInTheDocument();
    expect(screen.queryByText("Reader expectations")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand Module 2" }));
    expect(screen.getByText("Reader expectations")).toBeInTheDocument();
    expect(screen.queryByText("Sharpen your quill")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse Module 2" }));
    expect(screen.queryByText("Reader expectations")).not.toBeInTheDocument();
  });

  it("expands and collapses everything, submodules included, then lets each section go its own way", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Sharpen your quill")).toBeInTheDocument();
    expect(screen.getByText("Reader expectations")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse Module 2" }));
    expect(screen.queryByText("Reader expectations")).not.toBeInTheDocument();
    expect(screen.getByText("Sharpen your quill")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Sharpen your quill")).not.toBeInTheDocument();
  });

  it("shows lessons that sit in no module, and links each lesson to its builder page", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    // Welcome isn't in the Hub (not published), so it has no builder page to link to.
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Module 2" }));
    expect(screen.getByRole("link", { name: "Reader expectations" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA2");
    expect(screen.getByText("text ✓ · video –", { exact: false })).toBeInTheDocument();
  });

  it("finds modules and lessons by search, opening what contains a match and hiding the rest", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.type(screen.getByRole("searchbox", { name: "Find module or lesson" }), "quill");

    expect(screen.getByText("Sharpen your quill")).toBeInTheDocument();
    expect(screen.getByText("Module 1")).toBeInTheDocument();
    expect(screen.queryByText("Module 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("gives a lesson row the drag handle and Kajabi's hover actions, the changing ones disabled", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Expand Module 2" }));
    const row = screen.getByRole("link", { name: "Reader expectations" }).closest("li")!;

    expect(within(row).getByRole("img", { name: "Drag to reorder lesson" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Edit video" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA2");
    expect(within(row).getByRole("link", { name: "Open video preview" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA2");
    for (const name of ["Duplicate video", "Open video comments", "Delete video"]) expect(within(row).getByRole("button", { name })).toBeDisabled();
  });

  it("has no working preview for a lesson the Hub doesn't have", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course({ hubLessonIds: {} })} />);
    await user.click(screen.getByRole("button", { name: "Expand Module 2" }));
    // Not in the Hub: no builder page and no Kajabi id in a link either.
    expect(screen.queryByRole("link", { name: "Reader expectations" })).not.toBeInTheDocument();
    const row = screen.getByText("Reader expectations").closest("li")!;
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Open video preview" })).toBeDisabled();
  });

  it("gives modules and submodules their own actions", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Expand Module 1" }));

    for (const name of ["Edit module", "Duplicate module", "Open module preview", "Delete module"]) expect(screen.getAllByRole("button", { name })[0]).toBeDisabled();
    for (const name of ["Edit submodule", "Duplicate submodule", "Open submodule preview", "Delete submodule"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("img", { name: "Drag to reorder submodule" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add content" })).toHaveLength(3);
  });

  it("shows each row's status in a menu that can't change yet, with Publish allowed anywhere (what is above only limits what members see)", async () => {
    const user = userEvent.setup();
    render(<BuilderOutline course={course()} />);
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    const module2 = screen.getByRole("combobox", { name: "Status of Module 2" });
    expect(module2).toBeDisabled();
    expect(module2).toHaveValue("locked");
    expect(within(module2).getAllByRole("option").map((o) => o.textContent)).toEqual(["Draft", "Publish", "Schedule", "Drip", "Locked"]);

    // A lesson in a draft week, in a draft module: it can still be published, and will wait until they are.
    const draftLesson = screen.getByRole("combobox", { name: "Status of Sharpen your quill" });
    expect(draftLesson).toHaveValue("draft");
    // The whole menu is disabled for now, so compare the options' own attribute.
    expect(within(draftLesson).getByRole("option", { name: "Publish" })).not.toHaveAttribute("disabled");
    expect(within(draftLesson).getByRole("option", { name: "Draft" })).not.toHaveAttribute("disabled");
    // What isn't offered yet is marked, with the reason as a tooltip rather than option text.
    expect(within(draftLesson).getByRole("option", { name: "Schedule" })).toHaveAttribute("disabled");
    expect(within(draftLesson).getByRole("option", { name: "Schedule" })).toHaveAttribute("title", expect.stringMatching(/date or a delay/));

    // Under a locked module, Publish is fine too.
    expect(within(screen.getByRole("combobox", { name: "Status of Reader expectations" })).getByRole("option", { name: "Published" })).not.toHaveAttribute("disabled");
  });

  it("says when there is nothing in the course yet", () => {
    render(<BuilderOutline course={course({ loose: [], modules: [] })} />);
    expect(screen.getByText("0 Modules")).toBeInTheDocument();
    expect(screen.getByText("No modules yet.")).toBeInTheDocument();
  });

  it("shows a published lesson under a draft module as plain Published, with why members can't see it in its reason", async () => {
    const user = userEvent.setup();
    const odd = explainCourse(
      [{ kajabiId: "m1", parentKajabiId: null, position: 1, title: "Welcome to the Quill & Cup 180!", publishingOption: "draft" }],
      [{ kajabiId: "l1", moduleKajabiId: "m1", position: 1, title: "Meet your instructor", publishingOption: "published" }]
    );
    render(<BuilderOutline course={course({ loose: [], modules: odd.modules, content: {}, hubLessonIds: {} })} />);
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    const select = screen.getByRole("combobox", { name: "Status of Meet your instructor" });
    expect(select).toHaveValue("published");
    expect(within(select).getByRole("option", { name: "Published" })).toHaveTextContent(/^Published$/);
    expect(within(select).getByRole("option", { name: "Published" })).not.toHaveAttribute("disabled");
    // Published, but waiting: the row says what is holding it.
    expect(screen.getByText("Inside “Welcome to the Quill & Cup 180!” (Draft)")).toBeInTheDocument();
  });

  it("keeps every option's text short, so a long module title can't widen the menu", async () => {
    const user = userEvent.setup();
    const long = explainCourse(
      [{ kajabiId: "m1", parentKajabiId: null, position: 1, title: "Week 1: Start Strong! The Story You Need to Tell & The Character Who Drives It", publishingOption: "draft" }],
      [{ kajabiId: "l1", moduleKajabiId: "m1", position: 1, title: "Sharpen your quill", publishingOption: "draft" }]
    );
    render(<BuilderOutline course={course({ loose: [], modules: long.modules, content: {}, hubLessonIds: {} })} />);
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    for (const option of screen.getAllByRole("option")) expect(option.textContent!.length, option.outerHTML).toBeLessThan(15);
  });
});
