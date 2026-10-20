// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LessonDownloads from "@/app/(member)/courses/LessonDownloads";

describe("LessonDownloads", () => {
  it("renders nothing when the lesson has no downloads", () => {
    const { container } = render(<LessonDownloads slug="c" lessonId="l1" files={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each file with its size, linking through the access-checked download route (never a storage path)", () => {
    render(
      <LessonDownloads
        slug="the-ready-writer"
        lessonId="lesson-1"
        files={[
          { id: "f1", filename: "180_Program_Module_2_Week_1_Tracker_Sheet.pdf", size_bytes: 151_552 },
          { id: "f2", filename: "Notes.txt", size_bytes: null },
        ]}
      />
    );

    const card = screen.getByRole("region", { name: "Downloads" });
    const first = within(card).getByRole("link", { name: /Tracker_Sheet\.pdf \(148 KB\)/ });
    expect(first).toHaveAttribute("href", "/courses/the-ready-writer/lessons/lesson-1/files/f1");
    expect(within(card).getByRole("link", { name: "Notes.txt" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/lesson-1/files/f2");
  });
});
