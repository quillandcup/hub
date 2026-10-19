// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KajabiCoursesResult from "@/app/(admin)/admin/data/import/KajabiCoursesResult";
import type { CoursesSyncResult } from "@/lib/courses/sync";

const imported = (over: Partial<NonNullable<CoursesSyncResult["imported"]>["courses"][number]> = {}) => ({
  courses: [{ id: "c1", title: "The Ready Writer", modules: 3, lessons: 12, offers: 1, unplacedLessons: 0, ...over }],
  softDeleted: { courses: 0, modules: 0, lessons: 0, offers: 0 },
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("KajabiCoursesResult", () => {
  it("lists what was imported and which published courses were refreshed", () => {
    render(
      <KajabiCoursesResult
        courses={{
          imported: imported(),
          unpublished: [],
          processed: [
            { slug: "the-ready-writer", created: false, modules: 3, lessons: 12, comingSoon: 2, hiddenLessons: 1, deleted: { modules: 0, lessons: 1 }, access: { members: 40, removed: 2 } },
          ],
        }}
      />
    );

    expect(screen.getByText(/The Ready Writer: 3 modules, 12 lessons, 1 offers/)).toBeInTheDocument();
    expect(screen.getByText(/the-ready-writer: 12 lessons \(2 coming soon\), 40 with access, 2 access removed, 1 lessons and 0 modules removed/)).toBeInTheDocument();
  });

  it("warns when lessons couldn't be placed in their module", () => {
    render(<KajabiCoursesResult courses={{ imported: imported({ unplacedLessons: 4 }), unpublished: [], processed: [] }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("The Ready Writer: 4 lessons not placed in a module");
  });

  it("says the courses sync failed without implying the member sync did", () => {
    render(<KajabiCoursesResult courses={{ error: "Kajabi API error (500)" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("the member sync above is unaffected");
    expect(screen.getByRole("alert")).toHaveTextContent("Kajabi API error (500)");
  });

  it("shows a processing failure after a successful import", () => {
    render(<KajabiCoursesResult courses={{ imported: imported(), unpublished: [], processed: [], error: "boom" }} />);

    expect(screen.getByText("Processing stopped: boom")).toBeInTheDocument();
    expect(screen.getByText(/The Ready Writer: 3 modules/)).toBeInTheDocument();
  });

  describe("publishing an unpublished course", () => {
    const unpublished = [{ id: "c1", title: "The Ready Writer", slug: "the-ready-writer" }];
    const ui = () => <KajabiCoursesResult courses={{ imported: imported(), unpublished, processed: [] }} />;

    it("needs an access length before it can be published", () => {
      render(ui());
      expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    });

    it("publishes with the chosen length, then moves it out of the unpublished list", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ courses: [{ lessons: 12, comingSoon: 2, access: { members: 40 } }] }),
      });
      render(ui());
      await userEvent.selectOptions(screen.getByLabelText("Access length for The Ready Writer"), "1 year");
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Published the-ready-writer: 12 lessons (2 coming soon), access for 40 members"));
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process/courses",
        expect.objectContaining({ body: JSON.stringify({ course: "the-ready-writer", accessDuration: "1 year" }) })
      );
      expect(screen.queryByText("Not published in the Hub yet:")).not.toBeInTheDocument();
    });

    it("sends the opening date when one is chosen, so pre-order access starts then", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ courses: [] }) });
      render(ui());
      await userEvent.selectOptions(screen.getByLabelText("Access length for The Ready Writer"), "1 year");
      await userEvent.type(screen.getByLabelText("Launch date for The Ready Writer (optional)"), "2026-11-02");
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "the-ready-writer", accessDuration: "1 year", launchOn: "2026-11-02" });
    });

    it("sends null for lifetime access", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ courses: [] }) });
      render(ui());
      await userEvent.selectOptions(screen.getByLabelText("Access length for The Ready Writer"), "Lifetime");
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Published the-ready-writer: published"));
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "the-ready-writer", accessDuration: null });
    });

    it("shows the server's reason and keeps the course listed when publishing fails", async () => {
      fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "No Kajabi course matches" }) });
      render(ui());
      await userEvent.selectOptions(screen.getByLabelText("Access length for The Ready Writer"), "1 year");
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      expect(await screen.findByText("No Kajabi course matches")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    });
  });
});
