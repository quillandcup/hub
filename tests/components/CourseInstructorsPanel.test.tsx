// @vitest-environment jsdom
/** The course's instructors in its settings: who is listed, saving, and the shortcut to every course. The actions and the member list are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveCourseInstructorList: vi.fn(), addInstructorsToAllCourses: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/instructor-actions", () => actions);

import CourseInstructorsPanel from "@/app/(admin)/admin/courses/[id]/CourseInstructorsPanel";

const COURSE = "crs_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const MEMBERS = [
  { id: ADA, name: "Ada Example", email: "ada@example.test" },
  { id: BEA, name: "Bea Example", email: "bea@example.test" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ members: MEMBERS }) })));
});

describe("CourseInstructorsPanel", () => {
  it("says that no comment shows the badge while the course has no instructors, and offers neither save nor the shortcut yet", async () => {
    render(<CourseInstructorsPanel courseId={COURSE} instructorIds={[]} />);

    expect(screen.getByRole("note")).toHaveTextContent(/no comment on this course shows the Instructor badge/i);
    expect(screen.getByRole("button", { name: "Save instructors" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add these instructors to every course" })).toBeDisabled();
  });

  it("lists who teaches the course as chips and shows no warning", async () => {
    render(<CourseInstructorsPanel courseId={COURSE} instructorIds={[ADA]} />);

    expect(await screen.findByText("Ada Example")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add these instructors to every course" })).toBeEnabled();
  });

  it("saves the picked members and says how many comments changed", async () => {
    actions.saveCourseInstructorList.mockResolvedValue({ added: 1, removed: 0, recomputed: 3 });
    const user = userEvent.setup();
    render(<CourseInstructorsPanel courseId={COURSE} instructorIds={[]} />);

    await user.type(screen.getByPlaceholderText("Search for a member to add..."), "Bea");
    await user.click(await screen.findByText("Bea Example"));
    await user.click(screen.getByRole("button", { name: "Save instructors" }));

    await waitFor(() => expect(actions.saveCourseInstructorList).toHaveBeenCalledWith(COURSE, [BEA]));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. The badge changed on 3 comments.");
    expect(router.refresh).toHaveBeenCalled();
    // Saved, so there is nothing more to save, and the warning is gone.
    expect(screen.getByRole("button", { name: "Save instructors" })).toBeDisabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows why a save was refused and keeps the picks", async () => {
    actions.saveCourseInstructorList.mockResolvedValue({ error: "Couldn't save the instructors." });
    const user = userEvent.setup();
    render(<CourseInstructorsPanel courseId={COURSE} instructorIds={[ADA]} />);

    await user.click(await screen.findByRole("button", { name: /remove ada example/i }));
    await user.click(screen.getByRole("button", { name: "Save instructors" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the instructors.");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save instructors" })).toBeEnabled();
  });

  it("adds the instructors to every course and says how many courses gained them, or that they already had them", async () => {
    actions.addInstructorsToAllCourses.mockResolvedValueOnce({ courses: 2, recomputed: 5 }).mockResolvedValueOnce({ courses: 0, recomputed: 0 }).mockResolvedValueOnce({ error: "Add an instructor to this course first." });
    const user = userEvent.setup();
    render(<CourseInstructorsPanel courseId={COURSE} instructorIds={[ADA]} />);
    const button = screen.getByRole("button", { name: "Add these instructors to every course" });

    await user.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Added to 2 courses. Nobody was removed anywhere.");
    expect(actions.addInstructorsToAllCourses).toHaveBeenCalledWith(COURSE);

    await user.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Every course already has them."));

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Add an instructor to this course first.");
  });
});
