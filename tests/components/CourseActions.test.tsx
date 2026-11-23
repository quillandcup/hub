// @vitest-environment jsdom
/** The course page's ⋯ menu: which items it has for which kind of course, and that the two that change something open their confirm dialog. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.hoisted(() => vi.fn());
const deleteCourse = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/courses/delete-actions", () => ({ deleteCourse }));
vi.mock("@/app/(admin)/admin/courses/duplicate-actions", () => ({ duplicateCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/take-over-actions", () => ({ takeOverCourse: vi.fn() }));

import CourseActions from "@/app/(admin)/admin/courses/[id]/CourseActions";
import { deleteBlockedReason, duplicateBlockedReason, takeOverBlockedReason } from "@/lib/courses/blocked-reasons";

const COURSE = "crs_AAAAAAAAAAA1";
const dup = { modules: 1, lessons: 2, withVideo: 0, downloads: 0, tooDeep: false };
const take = { modules: 1, lessons: 2, withText: 1, withVideo: 0, downloads: 0, withoutSetting: 0, tooDeep: false };
const del = { modules: 2, lessons: 5, source: "hub", isDraft: true, members: 0, activity: 0 };
const openMenu = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Course actions" }));
  return user;
};

describe("CourseActions", () => {
  it("for a Hub-owned course has duplicate and watch stats (customers is a tab), and no take over", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={null} deletion={del} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Duplicate course" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Take over/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveAttribute("href", `/admin/courses/${COURSE}/stats`);
    expect(screen.queryByRole("menuitem", { name: "Who's where" })).not.toBeInTheDocument();
  });

  it("for a Kajabi course in the Hub also offers the take over", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={take} deletion={del} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Take over from Kajabi" })).toBeInTheDocument();
  });

  it("opens the duplicate dialog from the menu, and Cancel closes it", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={null} deletion={del} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Duplicate course" }));
    expect(screen.getByRole("dialog", { name: "Duplicate this course?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the take-over dialog from the menu", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={take} deletion={del} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Take over from Kajabi" }));
    expect(screen.getByRole("dialog", { name: "Take over from Kajabi?" })).toBeInTheDocument();
  });

  it("keeps a blocked item in the menu, off, with the reason, and opens nothing", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={{ ...dup, tooDeep: true }} takeOver={{ ...take, lessons: 0 }} deletion={del} />);
    const user = await openMenu();
    expect(screen.getByText(/nested deeper than the editor handles/)).toBeInTheDocument();
    expect(screen.getByText(/no lessons in the Hub yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Duplicate course/ }));
    await user.click(screen.getByRole("menuitem", { name: /Take over from Kajabi/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CourseActions delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks first, saying what goes with the course and that it can't be undone, and does nothing on Cancel", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab (copy)" duplicate={dup} takeOver={null} deletion={del} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Delete course" }));
    const dialog = screen.getByRole("dialog", { name: "Delete course?" });
    expect(dialog).toHaveTextContent("Plot Lab (copy)");
    expect(dialog).toHaveTextContent("Its 2 modules and 5 lessons are deleted with it.");
    expect(dialog).toHaveTextContent("This can't be undone.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteCourse).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes on confirm and goes back to the course list", async () => {
    deleteCourse.mockResolvedValue({ ok: true });
    render(<CourseActions courseId={COURSE} title="Plot Lab (copy)" duplicate={dup} takeOver={null} deletion={{ ...del, modules: 1, lessons: 1 }} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Delete course" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Its 1 module and 1 lesson are deleted with it.");
    await user.click(screen.getByRole("button", { name: "Delete course" }));
    expect(deleteCourse).toHaveBeenCalledWith(COURSE);
    expect(push).toHaveBeenCalledWith("/admin/courses");
  });

  it("keeps the dialog open with the reason when the server refuses, and when the call fails", async () => {
    deleteCourse.mockResolvedValueOnce({ error: "Members have access to this course or are due access, so it can't be deleted." });
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={null} deletion={del} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Delete course" }));
    await user.click(screen.getByRole("button", { name: "Delete course" }));
    expect(await screen.findByText(/have access to this course/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    deleteCourse.mockRejectedValueOnce(new Error("network"));
    await user.click(screen.getByRole("button", { name: "Delete course" }));
    expect(await screen.findByText(/Refresh the page and try again/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("is listed but off, with the reason, for a course that can't go, and opens nothing", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={null} takeOver={null} deletion={{ ...del, source: "kajabi" }} />);
    const user = await openMenu();
    expect(screen.getByText(/Remove it in Kajabi, then import again/)).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Delete course/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has no delete item when there is no preview", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={null} takeOver={null} deletion={null} />);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /Delete course/ })).not.toBeInTheDocument();
  });
});

describe("deleteBlockedReason", () => {
  it("is null for a draft Hub course nobody uses", () => {
    expect(deleteBlockedReason(del)).toBeNull();
  });
  it("names the first thing in the way: Kajabi, published, members, then what members left", () => {
    expect(deleteBlockedReason({ ...del, source: "kajabi", isDraft: false, members: 3 })).toMatch(/comes from Kajabi/);
    expect(deleteBlockedReason({ ...del, isDraft: false, members: 3 })).toMatch(/Unpublish it first/);
    expect(deleteBlockedReason({ ...del, members: 3 })).toMatch(/access/);
    expect(deleteBlockedReason({ ...del, activity: 2 })).toMatch(/progress or comments/);
  });
});

describe("blocked reasons", () => {
  it("are null for a course that can be copied or taken over", () => {
    expect(duplicateBlockedReason(dup)).toBeNull();
    expect(takeOverBlockedReason(take)).toBeNull();
  });
  it("name the nesting for both and the missing lessons for a take over", () => {
    expect(duplicateBlockedReason({ tooDeep: true })).toMatch(/can't be copied/);
    expect(takeOverBlockedReason({ tooDeep: true, lessons: 3 })).toMatch(/Flatten it in Kajabi/);
    expect(takeOverBlockedReason({ tooDeep: false, lessons: 0 })).toMatch(/Import it from Kajabi/);
  });
});
