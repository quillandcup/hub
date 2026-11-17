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

  it("moves focus into the dialog and gives it back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Modal isOpen onClose={() => {}} title="Video stats">
        <button>inside</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Video stats">
        <button>inside</button>
      </Modal>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("leaves focus alone when something inside already took it", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Video stats">
        <input aria-label="Name" autoFocus />
      </Modal>,
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  describe("Ctrl/Cmd+Enter", () => {
    const setup = (opts: { disabled?: boolean; form?: boolean } = {}) => {
      const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
      const user = userEvent.setup();
      const fields = (
        <>
          <label>
            Note
            <textarea />
          </label>
          <button type="submit" disabled={opts.disabled}>
            Save
          </button>
        </>
      );
      render(
        <Modal isOpen onClose={() => {}} title="Edit">
          {opts.form === false ? fields : <form onSubmit={onSubmit}>{fields}</form>}
        </Modal>,
      );
      return { user, onSubmit };
    };

    it("submits the form inside from a field, with Ctrl or Cmd", async () => {
      const { user, onSubmit } = setup();
      await user.click(screen.getByLabelText("Note"));
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await user.keyboard("{Meta>}{Enter}{/Meta}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it("leaves a plain Enter alone (a new line in a textarea)", async () => {
      const { user, onSubmit } = setup();
      await user.click(screen.getByLabelText("Note"));
      await user.keyboard("{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does nothing without a form around the field", async () => {
      const { user, onSubmit } = setup({ form: false });
      await user.click(screen.getByLabelText("Note"));
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("waits while the Save button is disabled", async () => {
      const { user, onSubmit } = setup({ disabled: true });
      await user.click(screen.getByLabelText("Note"));
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
