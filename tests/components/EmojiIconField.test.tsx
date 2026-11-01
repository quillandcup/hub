// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmojiIconField from "@/components/EmojiIconField";

vi.mock("@/components/chat/EmojiPicker", () => ({
  default: ({ onPick, onClose }: { onPick: (n: string) => void; onClose: () => void }) => (
    <div>
      <button onClick={() => onPick("tada")}>pick tada</button>
      <button onClick={() => onPick("wave::skin-tone-3")}>pick wave</button>
      <button onClick={() => onPick("not_an_emoji_name")}>pick unknown</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

describe("EmojiIconField", () => {
  it("shows the current icon and opens the picker", async () => {
    render(<EmojiIconField value="🏅" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Icon: 🏅/ })).toHaveTextContent("🏅");
    expect(screen.queryByText("pick tada")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Icon/ }));
    expect(screen.getByText("pick tada")).toBeInTheDocument();
  });

  it("reports the Unicode emoji and closes", async () => {
    const onChange = vi.fn();
    render(<EmojiIconField value="🏅" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Icon/ }));
    await userEvent.click(screen.getByText("pick tada"));
    expect(onChange).toHaveBeenCalledWith("🎉");
    expect(screen.queryByText("pick tada")).toBeNull();
  });

  it("applies a skin tone", async () => {
    const onChange = vi.fn();
    render(<EmojiIconField value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Icon: none/ }));
    await userEvent.click(screen.getByText("pick wave"));
    expect(onChange).toHaveBeenCalledWith("👋🏼");
  });

  it("ignores a name with no Unicode emoji", async () => {
    const onChange = vi.fn();
    render(<EmojiIconField value="🏅" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Icon/ }));
    await userEvent.click(screen.getByText("pick unknown"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
