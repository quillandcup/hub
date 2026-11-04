// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import EmojiPicker from "@/components/chat/EmojiPicker";

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

async function open() {
  const onPick = vi.fn();
  render(<EmojiPicker custom={{}} onPick={onPick} onClose={vi.fn()} />);
  await screen.findByRole("button", { name: "React with :grinning:" });
  return { onPick };
}

const section = (name: string) => within(screen.getByRole("group", { name }));

describe("EmojiPicker skin tone in the grid", () => {
  it("draws browse-grid emoji that take a tone in the chosen tone, and others as they are", async () => {
    const { onPick } = await open();
    expect(section("Smileys & People").getByRole("button", { name: "React with :wave:" })).toHaveTextContent("👋");
    await userEvent.click(screen.getByRole("button", { name: "Skin Tone" }));
    await userEvent.click(screen.getByRole("radio", { name: "Medium-light skin tone" }));
    const wave = section("Smileys & People").getByRole("button", { name: "React with :wave::skin-tone-3:" });
    expect(wave).toHaveTextContent("👋🏼");
    expect(section("Smileys & People").getByRole("button", { name: "React with :grinning:" })).toHaveTextContent("😀");
    await userEvent.click(wave);
    expect(onPick).toHaveBeenCalledWith("wave::skin-tone-3");
  });

  it("shows earlier plain picks in Frequently used in the chosen tone, once", async () => {
    localStorage.setItem("chat-recent-reactions", JSON.stringify(["clap", "clap::skin-tone-2", "grinning"]));
    localStorage.setItem("chat-skin-tone", "5");
    await open();
    const row = section("Frequently used");
    expect(row.getAllByRole("button")).toHaveLength(2);
    expect(row.getByRole("button", { name: "React with :clap::skin-tone-5:" })).toHaveTextContent("👏🏾");
    expect(row.getByRole("button", { name: "React with :grinning:" })).toBeInTheDocument();
  });
});
