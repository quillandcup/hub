// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "@/components/Modal";

describe("Modal", () => {
  it("is a labelled dialog and renders nothing when closed", () => {
    const { rerender } = render(
      <Modal isOpen onClose={() => {}} title="Video stats">
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Video stats" })).toHaveAttribute("aria-modal", "true");
    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Video stats">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape, the close button and the backdrop, but not on a click inside", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose} title="Video stats" maxWidth="5xl">
        <p>inside</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("max-w-5xl");

    await user.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("ignores Escape while closed", async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={false} onClose={onClose} title="Video stats">
        body
      </Modal>,
    );
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
