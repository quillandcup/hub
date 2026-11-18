// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ProjectCharts from "@/components/writing/ProjectCharts";
import type { EntryRow } from "@/app/(member)/projects/actions";
import { tooltipText, tooltipTexts } from "@/tests/helpers/tooltip";

const entry = (over: Partial<EntryRow>): EntryRow => ({
  id: "wpe_AAAAAAAAAAA1",
  projectId: "prj_AAAAAAAAAAA1",
  entryDate: "2026-11-05",
  measure: "words",
  mode: "delta",
  amount: 0,
  note: null,
  tags: [],
  createdAt: "2026-11-05T10:00:00Z",
  prickleId: null,
  prickleLabel: null,
  ...over,
});

describe("ProjectCharts heatmap", () => {
  it("shows what a set total added, not its whole value", () => {
    const { container } = render(
      <ProjectCharts
        entries={[entry({ mode: "set_total", amount: 56000 })]}
        startingBalances={{ words: 55000 }}
      />
    );
    expect(container.textContent).not.toContain("56,000");
    expect(tooltipTexts(container).some((t) => t.text.includes("1,000"))).toBe(true);
  });
});
