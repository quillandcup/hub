// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog, { useConfirm } from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";

afterEach(cleanup);

const click = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

function setup(over: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Delete lesson?" body="It is deleted for good." confirmLabel="Delete lesson" {...over} />);
  return { onClose, onConfirm };
}

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    render(<ConfirmDialog open={false} onClose={() => {}} onConfirm={() => {}} title="T" body="B" confirmLabel="Go" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the thing, says what happens and names the action, with Cancel focused first", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Delete lesson?" })).toBeInTheDocument();
    expect(screen.getByText("It is deleted for good.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete lesson" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("closes without confirming on Cancel, and uses a given cancel label", async () => {
    const { onClose, onConfirm } = setup({ cancelLabel: "Keep it" });
    await click("Keep it");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("confirms, waits for an async action, then closes", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { onClose } = setup({ onConfirm, tone: "danger" });
    await click("Delete lesson");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Delete lesson" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open and shows the reason when the action returns one, then lets the person try again", async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce("Couldn't delete the lesson.").mockResolvedValueOnce(undefined);
    const { onClose } = setup({ onConfirm });
    await click("Delete lesson");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the lesson.");
    expect(onClose).not.toHaveBeenCalled();
    await click("Delete lesson");
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says something went wrong when the action throws", async () => {
    setup({ onConfirm: vi.fn().mockRejectedValue(new Error("network")) });
    await click("Delete lesson");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });

  it("needs the exact text typed before it will confirm", async () => {
    const { onConfirm } = setup({ requireText: "Ada Example" });
    const input = screen.getByLabelText(/Type/);
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete lesson" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "ada example" } });
    expect(screen.getByRole("button", { name: "Delete lesson" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Ada Example " } });
    await click("Delete lesson");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("starts empty every time it opens", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={() => {}} title="T" body="B" confirmLabel="Go" requireText="Ada Example" />
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByLabelText(/Type/)).toHaveValue("");
  });
});

describe("where it is drawn", () => {
  it("is on the page body, so a table cell's no-wrap and right alignment can't reach it", () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <td className="whitespace-nowrap text-right">
              <ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Delete page?" body="It disappears from the public site." confirmLabel="Delete page" />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.closest("td")).toBeNull();
  });
});

describe("useConfirm", () => {
  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const { ask, dialog } = useConfirm();
    return (
      <>
        <button onClick={async () => onResult(await ask({ title: "Remove it?", body: "Gone.", confirmLabel: "Remove" }))}>open</button>
        {dialog}
      </>
    );
  }

  it("resolves true on confirm, and closes", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await click("open");
    await click("Remove");
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false on Cancel, on Escape and on a click outside", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await click("open");
    await click("Cancel");
    await click("open");
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await click("open");
    await act(async () => {
      fireEvent.click(screen.getByRole("dialog").parentElement!);
    });
    expect(onResult.mock.calls).toEqual([[false], [false], [false]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a confirm on top of another dialog", () => {
  it("takes Escape alone, leaving the dialog under it open", async () => {
    const onUnder = vi.fn();
    const onConfirmClose = vi.fn();
    render(
      <>
        <Modal isOpen onClose={onUnder} title="History">
          x
        </Modal>
        <ConfirmDialog open onClose={onConfirmClose} onConfirm={() => {}} title="Bring back?" body="B" confirmLabel="Bring back" />
      </>,
    );
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onConfirmClose).toHaveBeenCalledTimes(1);
    expect(onUnder).not.toHaveBeenCalled();
  });
});
