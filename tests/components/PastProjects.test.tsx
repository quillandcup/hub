// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PastProjects from "@/app/(member)/projects/PastProjects";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

const row = (over: Partial<WritingProjectRow> = {}) =>
  ({ id: "prj_AAAAAAAAAAA1", title: "Lantern Draft", phase: "abandoned", totalsByMeasure: {}, ...over }) as unknown as WritingProjectRow;

describe("PastProjects", () => {
  it("renders nothing without past projects", () => {
    const { container } = render(<PastProjects projects={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each past project with its status and totals, linking to it", () => {
    render(
      <PastProjects
        projects={[row({ totalsByMeasure: { words: 12000 } }), row({ id: "prj_AAAAAAAAAAA2", title: "Essays", phase: "complete" })]}
      />,
    );
    expect(screen.getByText("Past projects (2)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lantern Draft" })).toHaveAttribute("href", "/projects/prj_AAAAAAAAAAA1");
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Abandoned · 12,000 words")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Complete")).toBeInTheDocument();
  });
});
