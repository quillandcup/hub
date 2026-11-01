// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatsTabs from "@/app/(admin)/admin/courses/[id]/stats/StatsTabs";

const tabs = [
  { id: "engagement", label: "Engagement", content: <p>heatmap</p> },
  { id: "over-time", label: "Over time", content: <p>chart</p> },
  { id: "views", label: "Views", content: <p>visits</p> },
];

describe("StatsTabs", () => {
  it("shows the first tab and switches on click", async () => {
    const user = userEvent.setup();
    render(<StatsTabs tabs={tabs} label="Video stats" />);

    expect(screen.getByRole("tablist", { name: "Video stats" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Engagement" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("heatmap");

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(screen.getByRole("tab", { name: "Views" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("visits");
    expect(screen.queryByText("heatmap")).not.toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<StatsTabs tabs={tabs} label="Video stats" />);

    screen.getByRole("tab", { name: "Engagement" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Over time" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("chart");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Views" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("visits");

    await user.keyboard("a");
    expect(screen.getByRole("tab", { name: "Views" })).toHaveAttribute("aria-selected", "true");
  });
});
