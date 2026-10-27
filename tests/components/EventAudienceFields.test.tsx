// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import EventAudienceFields from "@/components/EventAudienceFields";
import { DEFAULT_AUDIENCE, type EventAudience } from "@/lib/event-audience";

function Harness({ initial = DEFAULT_AUDIENCE, onChange }: { initial?: EventAudience; onChange?: (v: EventAudience) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <EventAudienceFields
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("EventAudienceFields", () => {
  it("starts members-only with no sign-up, and hides how places go until there is a limit and sign-up", async () => {
    render(<Harness />);
    expect(screen.getByLabelText("Guests allowed")).not.toBeChecked();
    expect(screen.getByLabelText("Announced publicly")).not.toBeChecked();
    expect(screen.getByLabelText("How people join")).toHaveValue("none");
    expect(screen.queryByLabelText("When there are more people than places")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("How people join"), "application");
    expect(screen.queryByLabelText("When there are more people than places")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Places (empty for no limit)"), "7");
    expect(screen.getByLabelText("When there are more people than places")).toBeInTheDocument();
  });

  it("reports each change, turning an emptied limit back into no limit", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.type(screen.getByLabelText("Places (empty for no limit)"), "5");
    await userEvent.clear(screen.getByLabelText("Places (empty for no limit)"));
    await userEvent.type(screen.getByLabelText("Guest speakers"), "Ada Example");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ guests_allowed: true }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ announced_publicly: true }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ capacity: 5 }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ guests_allowed: true, announced_publicly: true, capacity: null, speakers: "Ada Example" });
  });

  it("lets the hosts choose when there are more people than places", async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ ...DEFAULT_AUDIENCE, registration: "signup", capacity: 7 }} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("When there are more people than places"), "selected");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ selection: "selected" }));
  });
});
