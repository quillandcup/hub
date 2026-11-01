// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setCoursePublished = vi.fn();
vi.mock("@/app/(admin)/admin/courses/actions", () => ({ setCoursePublished: (...a: unknown[]) => setCoursePublished(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import CoursePublishControl from "@/app/(admin)/admin/courses/CoursePublishControl";

const COURSE = "crs_AAAAAAAAAAA1";

beforeEach(() => {
  setCoursePublished.mockReset();
  refresh.mockReset();
});

describe("CoursePublishControl", () => {
  it("says a draft is only for staff, and publishes it", async () => {
    setCoursePublished.mockResolvedValue({ id: COURSE });
    render(<CoursePublishControl courseId={COURSE} isDraft />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/Only staff can see it/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(setCoursePublished).toHaveBeenCalledWith(COURSE, true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says a published course is open to members with access, and unpublishes it", async () => {
    setCoursePublished.mockResolvedValue({ id: COURSE });
    render(<CoursePublishControl courseId={COURSE} isDraft={false} />);
    expect(screen.getByText("Published")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(setCoursePublished).toHaveBeenCalledWith(COURSE, false);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the reason and does not refresh when the change fails", async () => {
    setCoursePublished.mockResolvedValue({ error: "Couldn't publish the course." });
    render(<CoursePublishControl courseId={COURSE} isDraft />);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't publish the course.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
