// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VisibilityControl, { visibilityLabel } from "@/components/writing/VisibilityControl";
import { tooltipText } from "@/tests/helpers/tooltip";

describe("VisibilityControl", () => {
  it("shows a lock and says only you can see it when private, and a click asks for community", async () => {
    const onChange = vi.fn();
    render(<VisibilityControl visibility="private" onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Who can see this goal: Only me" });
    expect(button.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(tooltipText(button)).toEqual("Only you can see this goal. Click to show it to other members, with its project.");
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith("community");
  });

  it("shows a house for signed-in members, and a click asks for public", async () => {
    const onChange = vi.fn();
    render(<VisibilityControl visibility="community" onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Who can see this goal: Other members" });
    expect(button.querySelector("svg.lucide-house")).not.toBeNull();
    expect(tooltipText(button)).toEqual(
      "Other members can see this goal on your profile, with its project. Click to open it to everyone on the internet, with its project, for your upcoming public profile."
    );
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith("public");
  });

  it("shows a globe for public, says the public profile is still coming, and a click goes back to private", async () => {
    const onChange = vi.fn();
    render(<VisibilityControl visibility="public" onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Who can see this goal: Everyone" });
    expect(button.querySelector("svg.lucide-globe")).not.toBeNull();
    expect(tooltipText(button)).toMatch(/Shown to everyone on the internet once you have a public profile \(coming soon\)\. Until then, other members can see it/);
    expect(tooltipText(button)).toMatch(/Click to make it private\.$/);
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith("private");
  });

  it("adds a text label and uses the noun for the project-level control", () => {
    render(<VisibilityControl visibility="private" onChange={() => {}} noun="project" withText />);
    const button = screen.getByRole("button", { name: "Who can see this project: Only me" });
    expect(button).toHaveTextContent("Only me");
    expect(tooltipText(button)).toEqual("Only you can see this project. Click to show it to other members, with its goals.");
  });

  it("says the project note about its goals, and plain copy for any other noun", () => {
    expect(visibilityLabel("public", "project")).toMatch(/Click to make it private \(its goals are hidden with it\)\.$/);
    expect(visibilityLabel("private", "book")).toEqual("Only you can see this book. Click to show it to other members.");
  });

  it("doesn't fire while disabled", async () => {
    const onChange = vi.fn();
    render(<VisibilityControl visibility="private" onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole("button", { name: /Who can see this goal/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
