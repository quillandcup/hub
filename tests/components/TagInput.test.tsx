// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagInput from "@/components/TagInput";

function Harness({ initial = [] as string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <label htmlFor="t">Tags</label>
      <TagInput id="t" tags={tags} onChange={setTags} placeholder="add one" />
      <button type="button">Next</button>
    </>
  );
}

describe("TagInput", () => {
  it("turns text into a pill on comma, Enter and Tab, and keeps focus on Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText("Tags");
    await user.type(box, "logo,");
    await user.type(box, "favicon{Enter}");
    await user.type(box, "hero{Tab}");
    expect(screen.getByLabelText("Remove logo")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove favicon")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove hero")).toBeInTheDocument();
    expect(box).toHaveFocus();
  });

  it("Tab on an empty box moves on, and blur keeps what was typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Tags"), "kept");
    await user.click(screen.getByText("Next"));
    expect(screen.getByLabelText("Remove kept")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Tags"));
    await user.tab();
    expect(screen.getByText("Next")).toHaveFocus();
  });

  it("removes a pill with its button or Backspace, and ignores duplicates", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b"]} />);
    const box = screen.getByLabelText("Tags");
    await user.type(box, "A,");
    expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(2);
    await user.click(screen.getByLabelText("Remove a"));
    await user.click(box);
    await user.keyboard("{Backspace}");
    expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
  });
});
