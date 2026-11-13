// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CopyLessonLink from "@/app/(member)/courses/CopyLessonLink";

const ADDRESS = "https://hub.example.com/courses/c/lessons/les_AAAAAAAAAAA1";

afterEach(cleanup);

describe("CopyLessonLink", () => {
  it("copies the lesson address and says so, with the hint about Hub Chat", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLessonLink url={ADDRESS} />);
    expect(screen.getByText(/paste it into hub chat/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("status")).toHaveTextContent("Copied.");
  });

  it("says so when the browser refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    render(<CopyLessonLink url={ADDRESS} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy");
  });
});
