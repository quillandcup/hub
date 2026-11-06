// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmotionPicker } from "@/components/writing/CheckinFields";
import type { Emotion } from "@/lib/prickle-checkins";

function Harness({ initial = null, onChange = vi.fn() }: { initial?: Emotion | null; onChange?: (e: Emotion | null) => void }) {
  const [value, setValue] = useState<Emotion | null>(initial);
  return (
    <EmotionPicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const ring = (name: string | RegExp) => within(screen.getByRole("group", { name }));
const chip = (name: string | RegExp, label: string) => ring(name).getByRole("button", { name: label });

describe("EmotionPicker usual feelings", () => {
  it("offers the member's usual feelings as one tap, and a second tap steps back to the core", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EmotionPicker value="sleepy" onChange={onChange} frequent={["sleepy", "content", "sad"]} />);

    expect(ring("Frequently used").getAllByRole("button").map((b) => b.textContent)).toEqual(["Sleepy", "Content", "Sad"]);
    await user.click(chip("Frequently used", "Content"));
    await user.click(chip("Frequently used", "Sleepy"));
    await user.click(render(<EmotionPicker value="sad" onChange={onChange} frequent={["sad"]} />).container.querySelector("[aria-label='Frequently used'] button") as HTMLElement);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["content", "sad", null]);
  });

  it("shows no such row without usual feelings or when read only", () => {
    const { unmount } = render(<EmotionPicker value={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Frequently used" })).not.toBeInTheDocument();
    unmount();
    render(<EmotionPicker value={null} onChange={vi.fn()} readOnly frequent={["content"]} />);
    expect(screen.queryByRole("group", { name: "Frequently used" })).not.toBeInTheDocument();
  });
});

describe("EmotionPicker", () => {
  it("drills from a core to its feelings, each middle-ring word paired with the outer-ring word beside it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(screen.queryByRole("group", { name: /More specifically/ })).not.toBeInTheDocument();
    await user.click(chip("Core feeling", "Mad"));
    expect(ring("More specifically, mad").getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Hurt",
      "Jealous",
      "Hostile",
      "Selfish",
      "Angry",
      "Frustrated",
      "Rage",
      "Furious",
      "Hateful",
      "Irritated",
      "Critical",
      "Skeptical",
    ]);
    // Each pair sits together, as on the wheel.
    expect(ring("More specifically, mad").getByRole("button", { name: "Furious" }).parentElement).toBe(
      ring("More specifically, mad").getByRole("button", { name: "Rage" }).parentElement
    );
    await user.click(chip("More specifically, mad", "Furious"));

    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["mad", "furious"]);
    expect(chip("Core feeling", "Mad")).toHaveAttribute("aria-pressed", "true");
    expect(chip("More specifically, mad", "Furious")).toHaveAttribute("aria-pressed", "true");
  });

  it("steps back out when the picked word is picked again, and clears from the core", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="furious" onChange={onChange} />);

    await user.click(chip("More specifically, mad", "Furious"));
    await user.click(chip("Core feeling", "Mad"));

    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["mad", null]);
    expect(screen.queryByRole("group", { name: /More specifically/ })).not.toBeInTheDocument();
  });

  it("switches to another feeling, or to another core", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="rage" onChange={onChange} />);
    await user.click(chip("More specifically, mad", "Hurt"));
    await user.click(chip("Core feeling", "Sad"));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["hurt", "sad"]);
    expect(ring("More specifically, sad").getByRole("button", { name: "Lonely" })).toBeInTheDocument();
  });

  it("searches the whole wheel and lands on the word, showing where it sits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.type(screen.getByRole("combobox", { name: /Search for a feeling/ }), "frus");
    const match = screen.getByRole("option", { name: /Frustrated/ });
    expect(match).toHaveTextContent("Mad");
    await user.click(match);

    expect(onChange).toHaveBeenLastCalledWith("frustrated");
    expect(chip("Core feeling", "Mad")).toHaveAttribute("aria-pressed", "true");
    expect(chip("More specifically, mad", "Frustrated")).toHaveAttribute("aria-pressed", "true");
  });

  it("suggests the closest wheel words for a word that isn't on the wheel, and says why", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("combobox", { name: /Search for a feeling/ }), "stuck");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Frustratedfor “stuck” · Mad",
      "Discouragedfor “stuck” · Scared",
      "Helplessfor “stuck” · Scared",
    ]);
    await user.click(options[0]);
    expect(onChange).toHaveBeenLastCalledWith("frustrated");
  });

  it("picks a search result from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("combobox", { name: /Search for a feeling/ }), "serene{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("serene");
  });

  it("finds every feeling under a core by the core's name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox", { name: /Search for a feeling/ }), "peaceful");
    // The core itself plus its twelve feelings, capped by the search's ten results.
    expect(screen.getByRole("option", { name: /Serene/ })).toHaveTextContent("Peaceful");
  });

  it("shows no search box when read-only", () => {
    render(<EmotionPicker value="lonely" onChange={() => {}} readOnly />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(chip("More specifically, sad", "Lonely")).toBeDisabled();
  });
});
