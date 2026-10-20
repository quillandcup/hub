// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describeEvents } from "@/lib/analytics/events";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ExploreForm } from "@/app/(admin)/admin/analytics/explore/ExploreForm";

const events = describeEvents();

function renderForm(props: Partial<React.ComponentProps<typeof ExploreForm>> = {}) {
  return render(<ExploreForm events={events} initialSteps={[]} initialBreakdown={null} initialDays={30} {...props} />);
}

function pushedUrl() {
  return new URL(push.mock.calls.at(-1)![0], "http://x");
}

beforeEach(() => push.mockClear());

describe("ExploreForm", () => {
  it("builds a filtered funnel from the plan and runs it", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await userEvent.selectOptions(screen.getByLabelText("Step 1 event"), "onair_popover_opened");
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    // Properties come from the plan: live and room_size, and a boolean offers true/false.
    expect(screen.getByLabelText("Step 1 filter 1 property")).toHaveValue("live");
    await userEvent.selectOptions(screen.getByLabelText("Step 1 filter 1 value"), "false");

    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await userEvent.selectOptions(screen.getByLabelText("Step 2 event"), "onair_join_clicked");
    await userEvent.selectOptions(screen.getByLabelText("Window"), "90");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    const url = pushedUrl();
    expect(url.searchParams.getAll("step")).toEqual(["onair_popover_opened:live=false", "onair_join_clicked"]);
    expect(url.searchParams.get("days")).toBe("90");
  });

  it("offers an enum property's own values", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await userEvent.selectOptions(screen.getByLabelText("Step 1 event"), "element_clicked");
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Step 1 filter 1 property"), "element");
    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Step 1 filter 1 value").options).map((o) => o.value);
    expect(options).toEqual(["", "button", "link", "input", "other"]);
  });

  it("leaves out a filter that was never given a value", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await userEvent.selectOptions(screen.getByLabelText("Step 1 event"), "onair_join_clicked");
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(pushedUrl().searchParams.getAll("step")).toEqual(["onair_join_clicked"]);
  });

  it("adds a breakdown by a property of an event", async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Breakdown event"), "onair_join_clicked");
    await userEvent.selectOptions(screen.getByLabelText("Breakdown property"), "live");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(pushedUrl().searchParams.get("breakdown")).toBe("onair_join_clicked.live");
    expect(pushedUrl().searchParams.getAll("step")).toEqual([]);
  });

  it("starts from the question in the URL, and steps can be removed", async () => {
    renderForm({
      initialSteps: [
        { event: "onair_popover_opened", where: { live: true } },
        { event: "onair_join_clicked", where: {} },
      ],
      initialDays: 7,
    });
    expect(screen.getByLabelText("Step 1 filter 1 value")).toHaveValue("true");
    expect(screen.getByLabelText("Window")).toHaveValue("7");
    await userEvent.click(screen.getAllByRole("button", { name: "Remove step" })[0]);
    expect(screen.queryByLabelText("Step 2 event")).toBeNull();
    expect(screen.getByLabelText("Step 1 event")).toHaveValue("onair_join_clicked");
  });

  it("stops adding steps at the limit", async () => {
    renderForm({ initialSteps: Array(6).fill({ event: "page_viewed", where: {} }) });
    expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
  });
});
