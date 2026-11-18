// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LifecycleButton from "@/components/LifecycleButton";
import LifecycleStatusChip from "@/components/LifecycleStatusChip";
import { tooltipText } from "@/tests/helpers/tooltip";

afterEach(cleanup);

const click = (name: string, scope: HTMLElement | Document = document.body) =>
  act(async () => {
    fireEvent.click(within(scope as HTMLElement).getByRole("button", { name }));
  });

describe("LifecycleButton", () => {
  it("as an icon is named and titled by the registry, and shows no text", () => {
    render(<LifecycleButton action="delete" noun="page" variant="icon" onRun={() => {}} />);
    const button = screen.getByRole("button", { name: "Delete page" });
    expect(tooltipText(button)).toEqual("Delete page");
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("as text shows the registry's label, or a longer one where a place needs it, with the icon when asked", () => {
    const { rerender } = render(<LifecycleButton action="history" noun="page" onRun={() => {}} />);
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("button").querySelector("svg")).toBeNull();
    rerender(<LifecycleButton action="publish" noun="page" label="Publish changes" withIcon onRun={() => {}} />);
    expect(screen.getByRole("button", { name: "Publish changes" }).querySelector("svg")).not.toBeNull();
  });

  it("runs at once for an action that doesn't ask", async () => {
    const onRun = vi.fn();
    render(<LifecycleButton action="duplicate" noun="course" onRun={onRun} track="admin-x" />);
    expect(screen.getByRole("button")).toHaveAttribute("data-track", "admin-x");
    await click("Duplicate course");
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks first for a delete, naming the thing, and runs only on confirm", async () => {
    const onRun = vi.fn();
    render(<LifecycleButton action="delete" noun="page" title="Spring sprint" detail="It disappears from the public site." variant="icon" onRun={onRun} />);
    await click("Delete page");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Delete page?" })).toBeInTheDocument();
    expect(within(dialog).getByText("“Spring sprint” will be deleted. It disappears from the public site.")).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();

    await click("Cancel", dialog);
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    await click("Delete page");
    await click("Delete page", screen.getByRole("dialog"));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays disabled while busy", () => {
    render(<LifecycleButton action="unpublish" noun="course" disabled onRun={() => {}} />);
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeDisabled();
  });
});

describe("LifecycleStatusChip", () => {
  it("says Draft or Published and nothing else", () => {
    const { rerender } = render(<LifecycleStatusChip published={false} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    rerender(<LifecycleStatusChip published />);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).toBeNull();
  });
});
