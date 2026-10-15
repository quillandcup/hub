// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import ResultsSearchBox from "@/components/search/ResultsSearchBox";

describe("ResultsSearchBox", () => {
  it("navigates to the results page for the typed query", async () => {
    const user = userEvent.setup();
    render(<ResultsSearchBox basePath="/search" initial="" placeholder="Search" maxLength={200} />);
    await user.type(screen.getByRole("textbox", { name: "Search" }), "pen name{Enter}");
    expect(push).toHaveBeenCalledWith("/search?q=pen%20name");
  });
});
