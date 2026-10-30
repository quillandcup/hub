// @vitest-environment jsdom
/** The course builder prototype: the form is shown, but nothing in it can be edited or saved yet. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { SUPPORT_EMAIL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

import NewCoursePage from "@/app/(admin)/admin/courses/new/page";

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
});

describe("/admin/courses/new", () => {
  it("checks the caller is an admin first", async () => {
    await renderServerPage(NewCoursePage, {});
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("points admins to support for a Kajabi import", async () => {
    await renderServerPage(NewCoursePage, {});
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(screen.getByText(/import it from Kajabi/)).toBeInTheDocument();
  });

  it("leaves every field and button disabled", async () => {
    await renderServerPage(NewCoursePage, {});
    const form = screen.getByRole("form", { name: "Course builder" });
    const controls = form.querySelectorAll("input, select, textarea, button");
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      // The outline's search and its Expand all only read the course.
      if (control.matches("input[type=search]") || control.textContent === "Expand all") continue;
      expect(control, control.outerHTML).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Save course" })).toBeDisabled();
  });
});
