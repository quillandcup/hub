// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import SoftGetForm from "@/app/(admin)/admin/courses/[id]/stats/SoftGetForm";

describe("SoftGetForm", () => {
  it("replaces the URL with the form's fields instead of loading a new page", async () => {
    replace.mockReset();
    const user = userEvent.setup();
    render(
      <SoftGetForm action="/admin/courses/crs_1/stats/les_1">
        <input type="hidden" name="staff" value="1" />
        <input name="from" defaultValue="" aria-label="From" />
        <select name="by" defaultValue="week" aria-label="By">
          <option value="day">Day</option>
          <option value="week">Week</option>
        </select>
        <button type="submit">Apply</button>
      </SoftGetForm>,
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(replace).toHaveBeenCalledWith("/admin/courses/crs_1/stats/les_1?staff=1&from=&by=week");
  });
});
