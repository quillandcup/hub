// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const createCourse = vi.fn();
const updateCourseDetails = vi.fn();
vi.mock("@/app/(admin)/admin/courses/actions", () => ({
  createCourse: (...a: unknown[]) => createCourse(...a),
  updateCourseDetails: (...a: unknown[]) => updateCourseDetails(...a),
}));

import CourseDetailsForm from "@/app/(admin)/admin/courses/CourseDetailsForm";
import { ACCESS_OPTIONS } from "@/lib/courses/access-options";

const BLANK = { title: "", slug: "", description: "", accessChoice: "", launchOn: "", programId: "" };
const PROGRAMS = [
  { id: "prg_AAAAAAAAAAA1", name: "180 Program" },
  { id: "prg_AAAAAAAAAAA2", name: "Self-Editing Academy" },
];
const COURSE = "crs_AAAAAAAAAAA1";

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  createCourse.mockReset();
  updateCourseDetails.mockReset();
});

describe("CourseDetailsForm, creating", () => {
  it("sends what was typed and chosen, then opens the new course", async () => {
    createCourse.mockResolvedValue({ id: COURSE });
    const user = userEvent.setup();
    render(<CourseDetailsForm initial={BLANK} programs={PROGRAMS} />);

    await user.type(screen.getByLabelText("Name"), "The Ready Writer");
    await user.type(screen.getByLabelText("Description"), "Learn to write.");
    await user.selectOptions(screen.getByLabelText("Access length"), ACCESS_OPTIONS[1].label);
    await user.selectOptions(screen.getByLabelText("Program"), "180 Program");
    await user.type(screen.getByLabelText("Opens"), "2026-11-02");
    await user.click(screen.getByRole("button", { name: "Create course" }));

    expect(createCourse).toHaveBeenCalledWith({
      title: "The Ready Writer",
      slug: "",
      description: "Learn to write.",
      accessChoice: "1",
      launchOn: "2026-11-02",
      programId: "prg_AAAAAAAAAAA1",
    });
    expect(updateCourseDetails).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith(`/admin/courses/${COURSE}`);
  });

  it("shows the address the name will get, and that members will open it there", async () => {
    const user = userEvent.setup();
    render(<CourseDetailsForm initial={BLANK} programs={PROGRAMS} />);
    await user.type(screen.getByLabelText("Name"), "Café & Quill!");
    expect(screen.getByLabelText("Address")).toHaveAttribute("placeholder", "cafe-and-quill");
    expect(screen.getByText(/Members open it at \/courses\/cafe-and-quill\./)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Address"), "my-own");
    expect(screen.getByText(/\/courses\/my-own\./)).toBeInTheDocument();
  });

  it("marks each field the server refused, in the field's own description, and doesn't leave the page", async () => {
    createCourse.mockResolvedValue({ fieldErrors: { title: "Give the course a name.", accessChoice: "Choose how long access lasts.", slug: "Another course already uses that address." } });
    const user = userEvent.setup();
    render(<CourseDetailsForm initial={BLANK} programs={PROGRAMS} />);
    await user.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByText("Give the course a name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Give the course a name.");
    expect(screen.getByLabelText("Access length")).toHaveAccessibleDescription("Choose how long access lasts.");
    // A hint and an error are both read with the field, and neither is part of its name.
    expect(screen.getByLabelText("Address")).toHaveAccessibleDescription(/Members open it at.*Another course already uses that address\./);
    // One alert per refused field, plus the summary beside the button.
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.getByText("Fix what's marked and save again.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a general failure, and keeps what was typed", async () => {
    createCourse.mockResolvedValue({ error: "Couldn't create the course." });
    const user = userEvent.setup();
    render(<CourseDetailsForm initial={BLANK} programs={PROGRAMS} />);
    await user.type(screen.getByLabelText("Name"), "Kept");
    await user.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByText("Couldn't create the course.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Kept");
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("CourseDetailsForm, editing", () => {
  const initial = { title: "The Ready Writer", slug: "the-ready-writer", description: "", accessChoice: "1", launchOn: "2026-11-02", programId: "" };

  it("starts from the saved details and saves them for that course, then says so and refreshes", async () => {
    updateCourseDetails.mockResolvedValue({ id: COURSE });
    const user = userEvent.setup();
    render(<CourseDetailsForm courseId={COURSE} initial={initial} programs={PROGRAMS} />);
    expect(screen.getByLabelText("Name")).toHaveValue("The Ready Writer");
    expect(screen.getByLabelText("Access length")).toHaveValue("1");
    expect(screen.getByLabelText("Opens")).toHaveValue("2026-11-02");

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "The Ready Writer 2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateCourseDetails).toHaveBeenCalledWith(COURSE, { ...initial, title: "The Ready Writer 2" });
    expect(createCourse).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("warns that changing the address breaks links people have", () => {
    render(<CourseDetailsForm courseId={COURSE} initial={initial} programs={PROGRAMS} />);
    expect(screen.getByText(/Changing it breaks links people already have/)).toBeInTheDocument();
  });

  it("shows why a save was refused, without saying Saved", async () => {
    updateCourseDetails.mockResolvedValue({ error: "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi." });
    const user = userEvent.setup();
    render(<CourseDetailsForm courseId={COURSE} initial={initial} programs={PROGRAMS} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/imported from Kajabi/);
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
