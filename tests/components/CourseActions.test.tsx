// @vitest-environment jsdom
/** The course page's ⋯ menu: which items it has for which kind of course, and that the two that change something open their confirm dialog. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/courses/duplicate-actions", () => ({ duplicateCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/take-over-actions", () => ({ takeOverCourse: vi.fn() }));

import CourseActions from "@/app/(admin)/admin/courses/[id]/CourseActions";
import { duplicateBlockedReason, takeOverBlockedReason } from "@/lib/courses/blocked-reasons";

const COURSE = "crs_AAAAAAAAAAA1";
const dup = { modules: 1, lessons: 2, withVideo: 0, downloads: 0, tooDeep: false };
const take = { modules: 1, lessons: 2, withText: 1, withVideo: 0, downloads: 0, withoutSetting: 0, tooDeep: false };
const openMenu = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Course actions" }));
  return user;
};

describe("CourseActions", () => {
  it("for a Hub-owned course has duplicate and watch stats (customers is a tab), and no take over", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={null} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Duplicate course" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Take over/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveAttribute("href", `/admin/courses/${COURSE}/stats`);
    expect(screen.queryByRole("menuitem", { name: "Who's where" })).not.toBeInTheDocument();
  });

  it("for a Kajabi course in the Hub also offers the take over", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={take} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Take over from Kajabi" })).toBeInTheDocument();
  });

  it("opens the duplicate dialog from the menu, and Cancel closes it", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={null} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Duplicate course" }));
    expect(screen.getByRole("dialog", { name: "Duplicate this course?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the take-over dialog from the menu", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={dup} takeOver={take} />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Take over from Kajabi" }));
    expect(screen.getByRole("dialog", { name: "Take over from Kajabi?" })).toBeInTheDocument();
  });

  it("keeps a blocked item in the menu, off, with the reason, and opens nothing", async () => {
    render(<CourseActions courseId={COURSE} title="Plot Lab" duplicate={{ ...dup, tooDeep: true }} takeOver={{ ...take, lessons: 0 }} />);
    const user = await openMenu();
    expect(screen.getByText(/nested deeper than the editor handles/)).toBeInTheDocument();
    expect(screen.getByText(/no lessons in the Hub yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Duplicate course/ }));
    await user.click(screen.getByRole("menuitem", { name: /Take over from Kajabi/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
