// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import BadgeTypeForm from "@/app/(admin)/admin/badges/BadgeTypeForm";
import { tooltipText } from "@/tests/helpers/tooltip";

afterEach(cleanup);

const initial = {
  name: "Hostess",
  description: "Hosted prickles",
  icon: "🏅",
  category: "community" as const,
  hasLevels: true,
  levels: [
    { level: 1, name: "Bronze", threshold: "1" },
    { level: 2, name: "Silver", threshold: "5" },
  ],
  eventId: null,
  programId: null,
};

describe("BadgeTypeForm levels", () => {
  it("reorders the levels by dragging a handle over another row, and says the handle drags", () => {
    render(<BadgeTypeForm mode="edit" badgeTypeId="bdg_1" initial={initial} />);
    const names = () => screen.getAllByPlaceholderText("e.g., 5x Hostess").map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual(["Bronze", "Silver"]);

    const handles = screen.getAllByText("⠿");
    expect(tooltipText(handles[1])).toBe("Drag to reorder");
    fireEvent.dragStart(handles[1]);
    fireEvent.dragOver(handles[0].closest("div")!);
    expect(names()).toEqual(["Silver", "Bronze"]);
    fireEvent.dragEnd(handles[1]);
    // After the drop nothing is being dragged: hovering another row doesn't move anything.
    fireEvent.dragOver(screen.getAllByText("⠿")[1].closest("div")!);
    expect(names()).toEqual(["Silver", "Bronze"]);
  });

  it("shows the level inputs only when the badge has levels", async () => {
    render(<BadgeTypeForm mode="create" />);
    expect(screen.queryByText("⠿")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Has levels/ }));
    expect(screen.getByText("⠿")).toBeInTheDocument();
  });
});
